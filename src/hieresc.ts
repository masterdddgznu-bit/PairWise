import {
  CapacityError,
  ConflictError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
  UnknownError,
} from "./errors.js";
import { VirtualClock } from "./clock.js";

export type EscrowStatus = "held" | "settled" | "released" | "expired";

export type JournalEntry =
  | { type: "addNode"; id: string; parentId: string | null; limit: number }
  | { type: "reserve"; escrowId: number; nodeId: string; amount: number; deadline: number }
  | { type: "release"; escrowId: number }
  | { type: "settle"; escrowId: number }
  | { type: "expire"; escrowId: number };

export interface HierEscOptions {
  clock: VirtualClock;
  maxNodes?: number;
  maxEscrows?: number;
}

interface NodeState {
  id: string;
  parentId: string | null;
  limit: number;
  used: number;
  reserved: number;
}

interface EscrowState {
  id: number;
  nodeId: string;
  amount: number;
  deadline: number;
  status: EscrowStatus;
}

const DEFAULT_MAX_NODES = 32;
const DEFAULT_MAX_ESCROWS = 64;

function validCap(v: number): boolean {
  return Number.isInteger(v) && v >= 1;
}

export class HierEsc {
  private readonly clock: VirtualClock;
  private readonly maxNodes: number;
  private readonly maxEscrows: number;
  private readonly nodes = new Map<string, NodeState>();
  private readonly escrows = new Map<number, EscrowState>();
  private readonly log: JournalEntry[] = [];
  private nextEscrowId = 1;

  constructor(opts: HierEscOptions) {
    const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    const maxEscrows = opts.maxEscrows ?? DEFAULT_MAX_ESCROWS;
    if (!validCap(maxNodes) || !validCap(maxEscrows)) {
      throw new InvalidConfigError("maxNodes and maxEscrows must be integers >= 1");
    }
    this.clock = opts.clock;
    this.maxNodes = maxNodes;
    this.maxEscrows = maxEscrows;
  }

  static fromJournal(
    clock: VirtualClock,
    opts: { maxNodes?: number; maxEscrows?: number },
    entries: readonly JournalEntry[],
  ): HierEsc {
    const h = new HierEsc({ clock, ...opts });
    for (const entry of entries) {
      h.apply(entry);
    }
    return h;
  }

  journal(): JournalEntry[] {
    return this.log.map((e) => ({ ...e }));
  }

  addNode(id: string, parentId: string | null, limit: number): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidArgError("node id must be a non-empty string");
    }
    if (!Number.isInteger(limit) || limit < 0) {
      throw new InvalidArgError("limit must be an integer >= 0");
    }
    if (this.nodes.has(id)) {
      throw new ConflictError(`node already exists: ${id}`);
    }
    if (parentId !== null && !this.nodes.has(parentId)) {
      throw new UnknownError(`unknown parent node: ${parentId}`);
    }
    if (this.nodes.size >= this.maxNodes) {
      throw new CapacityError("node capacity reached");
    }
    this.apply({ type: "addNode", id, parentId, limit });
  }

  reserve(nodeId: string, amount: number, ttlMs: number): { escrowId: number } {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new InvalidArgError("amount must be a positive number");
    }
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new InvalidArgError("ttlMs must be a positive integer");
    }
    const node = this.nodeOrThrow(nodeId);
    let held = 0;
    for (const e of this.escrows.values()) {
      if (e.status === "held") held += 1;
    }
    if (held >= this.maxEscrows) {
      throw new CapacityError("escrow capacity reached");
    }
    if (this.pathMinAvailable(nodeId) < amount) {
      throw new CapacityError("insufficient available capacity on ancestor path");
    }
    const escrowId = this.nextEscrowId;
    const deadline = this.clock.now() + ttlMs;
    this.apply({ type: "reserve", escrowId, nodeId: node.id, amount, deadline });
    return { escrowId };
  }

  release(escrowId: number): void {
    const e = this.escrowOrThrow(escrowId);
    if (e.status !== "held") {
      throw new StateError(`escrow ${escrowId} is not held`);
    }
    this.apply({ type: "release", escrowId });
  }

  settle(escrowId: number): void {
    const e = this.escrowOrThrow(escrowId);
    if (e.status !== "held") {
      throw new StateError(`escrow ${escrowId} is not held`);
    }
    this.apply({ type: "settle", escrowId });
  }

  drive(): number[] {
    const now = this.clock.now();
    const due = [...this.escrows.values()]
      .filter((e) => e.status === "held" && e.deadline <= now)
      .map((e) => e.id)
      .sort((a, b) => a - b);
    for (const escrowId of due) {
      this.apply({ type: "expire", escrowId });
    }
    return due;
  }

  statusOf(escrowId: number): EscrowStatus {
    return this.escrowOrThrow(escrowId).status;
  }

  limitOf(id: string): number {
    return this.nodeOrThrow(id).limit;
  }

  usedOf(id: string): number {
    return this.nodeOrThrow(id).used;
  }

  reservedOf(id: string): number {
    return this.nodeOrThrow(id).reserved;
  }

  availableOf(id: string): number {
    const n = this.nodeOrThrow(id);
    return n.limit - n.used - n.reserved;
  }

  pathMinAvailable(id: string): number {
    let cur: NodeState | undefined = this.nodeOrThrow(id);
    let min = Infinity;
    while (cur !== undefined) {
      const avail = cur.limit - cur.used - cur.reserved;
      if (avail < min) min = avail;
      cur = cur.parentId === null ? undefined : this.nodes.get(cur.parentId);
    }
    return min;
  }

  private nodeOrThrow(id: string): NodeState {
    const n = this.nodes.get(id);
    if (n === undefined) {
      throw new UnknownError(`unknown node: ${id}`);
    }
    return n;
  }

  private escrowOrThrow(escrowId: number): EscrowState {
    const e = this.escrows.get(escrowId);
    if (e === undefined) {
      throw new UnknownError(`unknown escrow: ${escrowId}`);
    }
    return e;
  }

  private apply(entry: JournalEntry): void {
    switch (entry.type) {
      case "addNode":
        this.nodes.set(entry.id, {
          id: entry.id,
          parentId: entry.parentId,
          limit: entry.limit,
          used: 0,
          reserved: 0,
        });
        break;
      case "reserve": {
        const node = this.nodes.get(entry.nodeId);
        if (node === undefined) {
          throw new UnknownError(`unknown node: ${entry.nodeId}`);
        }
        node.reserved += entry.amount;
        this.escrows.set(entry.escrowId, {
          id: entry.escrowId,
          nodeId: entry.nodeId,
          amount: entry.amount,
          deadline: entry.deadline,
          status: "held",
        });
        if (entry.escrowId >= this.nextEscrowId) {
          this.nextEscrowId = entry.escrowId + 1;
        }
        break;
      }
      case "release": {
        const e = this.escrows.get(entry.escrowId);
        if (e === undefined) throw new UnknownError(`unknown escrow: ${entry.escrowId}`);
        this.nodes.get(e.nodeId)!.reserved -= e.amount;
        e.status = "released";
        break;
      }
      case "settle": {
        const e = this.escrows.get(entry.escrowId);
        if (e === undefined) throw new UnknownError(`unknown escrow: ${entry.escrowId}`);
        const node = this.nodes.get(e.nodeId)!;
        node.reserved -= e.amount;
        node.used += e.amount;
        e.status = "settled";
        break;
      }
      case "expire": {
        const e = this.escrows.get(entry.escrowId);
        if (e === undefined) throw new UnknownError(`unknown escrow: ${entry.escrowId}`);
        this.nodes.get(e.nodeId)!.reserved -= e.amount;
        e.status = "expired";
        break;
      }
    }
    this.log.push(entry);
  }
}
