import {
  CapacityError,
  ConflictError,
  InvalidArgError,
  InvalidConfigError,
  StateError,
  UnknownError,
} from "./errors.js";
import type { VirtualClock } from "./clock.js";
import type { JournalEntry } from "./journal.js";

export type EscrowStatus = "held" | "settled" | "released" | "expired";

export interface HierEscOptions {
  clock: VirtualClock;
  maxNodes?: number;
  maxEscrows?: number;
}

interface NodeRec {
  id: string;
  parentId: string | null;
  limit: number;
  used: number;
  reserved: number;
}

interface EscrowRec {
  id: number;
  nodeId: string;
  amount: number;
  deadline: number;
  status: EscrowStatus;
}

const DEFAULT_MAX_NODES = 32;
const DEFAULT_MAX_ESCROWS = 64;

function checkCap(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1`);
  }
}

export class HierEsc {
  private readonly clock: VirtualClock;
  private readonly maxNodes: number;
  private readonly maxEscrows: number;
  private readonly nodes = new Map<string, NodeRec>();
  private readonly escrows = new Map<number, EscrowRec>();
  private nextEscrowId = 1;
  private readonly log: JournalEntry[] = [];

  constructor(opts: HierEscOptions) {
    if (opts === null || typeof opts !== "object" || !opts.clock) {
      throw new InvalidConfigError("opts.clock (VirtualClock) is required");
    }
    const maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    const maxEscrows = opts.maxEscrows ?? DEFAULT_MAX_ESCROWS;
    checkCap(maxNodes, "maxNodes");
    checkCap(maxEscrows, "maxEscrows");
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
      h.replay(entry);
    }
    return h;
  }

  private replay(entry: JournalEntry): void {
    switch (entry.type) {
      case "addNode": {
        this.nodes.set(entry.id, {
          id: entry.id,
          parentId: entry.parentId,
          limit: entry.limit,
          used: 0,
          reserved: 0,
        });
        break;
      }
      case "reserve": {
        const node = this.nodes.get(entry.nodeId);
        if (!node) throw new UnknownError(`unknown node: ${entry.nodeId}`);
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
      case "release":
      case "settle":
      case "expire": {
        const esc = this.escrows.get(entry.escrowId);
        if (!esc) throw new UnknownError(`unknown escrow: ${entry.escrowId}`);
        const node = this.nodes.get(esc.nodeId);
        if (!node) throw new UnknownError(`unknown node: ${esc.nodeId}`);
        node.reserved -= esc.amount;
        if (entry.type === "settle") {
          node.used += esc.amount;
          esc.status = "settled";
        } else {
          esc.status = entry.type === "release" ? "released" : "expired";
        }
        break;
      }
    }
  }

  private append(entry: JournalEntry): void {
    this.log.push(entry);
  }

  journal(): ReadonlyArray<JournalEntry> {
    return this.log.map((e) => ({ ...e }));
  }

  private nodeOrThrow(id: string): NodeRec {
    const node = this.nodes.get(id);
    if (!node) throw new UnknownError(`unknown node: ${id}`);
    return node;
  }

  private escrowOrThrow(escrowId: number): EscrowRec {
    const esc = this.escrows.get(escrowId);
    if (!esc) throw new UnknownError(`unknown escrow: ${escrowId}`);
    return esc;
  }

  addNode(id: string, parentId: string | null, limit: number): void {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidArgError("id must be a non-empty string");
    }
    if (!Number.isInteger(limit) || limit < 0) {
      throw new InvalidArgError("limit must be an integer >= 0");
    }
    if (parentId !== null && typeof parentId !== "string") {
      throw new InvalidArgError("parentId must be a string or null");
    }
    if (this.nodes.has(id)) {
      throw new ConflictError(`node already exists: ${id}`);
    }
    if (parentId !== null && !this.nodes.has(parentId)) {
      throw new UnknownError(`unknown parent node: ${parentId}`);
    }
    if (this.nodes.size >= this.maxNodes) {
      throw new CapacityError("maxNodes capacity reached");
    }
    this.nodes.set(id, { id, parentId, limit, used: 0, reserved: 0 });
    this.append({ type: "addNode", id, parentId, limit });
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
    const node = this.nodeOrThrow(id);
    return node.limit - node.used - node.reserved;
  }

  pathMinAvailable(id: string): number {
    let node = this.nodeOrThrow(id);
    let min = node.limit - node.used - node.reserved;
    while (node.parentId !== null) {
      node = this.nodeOrThrow(node.parentId);
      const avail = node.limit - node.used - node.reserved;
      if (avail < min) min = avail;
    }
    return min;
  }

  private activeEscrowCount(): number {
    let count = 0;
    for (const esc of this.escrows.values()) {
      if (esc.status === "held") count += 1;
    }
    return count;
  }

  reserve(
    nodeId: string,
    amount: number,
    ttlMs: number,
  ): { escrowId: number } {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new InvalidArgError("amount must be a positive number");
    }
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new InvalidArgError("ttlMs must be a positive integer");
    }
    const node = this.nodeOrThrow(nodeId);
    if (this.activeEscrowCount() >= this.maxEscrows) {
      throw new CapacityError("maxEscrows capacity reached");
    }
    if (this.pathMinAvailable(nodeId) < amount) {
      throw new CapacityError("insufficient available capacity on path");
    }
    const escrowId = this.nextEscrowId;
    this.nextEscrowId += 1;
    const deadline = this.clock.now() + ttlMs;
    node.reserved += amount;
    this.escrows.set(escrowId, {
      id: escrowId,
      nodeId,
      amount,
      deadline,
      status: "held",
    });
    this.append({ type: "reserve", escrowId, nodeId, amount, deadline });
    return { escrowId };
  }

  release(escrowId: number): void {
    const esc = this.escrowOrThrow(escrowId);
    if (esc.status !== "held") {
      throw new StateError(`escrow ${escrowId} is not held`);
    }
    const node = this.nodeOrThrow(esc.nodeId);
    node.reserved -= esc.amount;
    esc.status = "released";
    this.append({ type: "release", escrowId });
  }

  settle(escrowId: number): void {
    const esc = this.escrowOrThrow(escrowId);
    if (esc.status !== "held") {
      throw new StateError(`escrow ${escrowId} is not held`);
    }
    const node = this.nodeOrThrow(esc.nodeId);
    node.reserved -= esc.amount;
    node.used += esc.amount;
    esc.status = "settled";
    this.append({ type: "settle", escrowId });
  }

  drive(): number[] {
    const now = this.clock.now();
    const due: EscrowRec[] = [];
    for (const esc of this.escrows.values()) {
      if (esc.status === "held" && esc.deadline <= now) {
        due.push(esc);
      }
    }
    due.sort((a, b) => a.id - b.id);
    const expiredIds: number[] = [];
    for (const esc of due) {
      const node = this.nodeOrThrow(esc.nodeId);
      node.reserved -= esc.amount;
      esc.status = "expired";
      this.append({ type: "expire", escrowId: esc.id });
      expiredIds.push(esc.id);
    }
    return expiredIds;
  }

  statusOf(escrowId: number): EscrowStatus {
    return this.escrowOrThrow(escrowId).status;
  }
}
