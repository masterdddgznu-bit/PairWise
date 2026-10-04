import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidAcquireError,
  InvalidConfigError,
  InvalidReleaseError,
  UnknownNodeError,
  UnknownTicketError,
} from "./errors.js";

export interface NestLeaseOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxWaitersPerNode?: number;
}

export interface AcquireOptions {
  priority?: number;
}

export type AcquireResult =
  | { status: "granted"; fence: number }
  | { status: "waiting"; ticket: number };

export interface DriveReport {
  expired: string[];
}

interface Waiter {
  ticket: number;
  holderId: string;
  priority: number;
  enqueuedAt: number;
}

interface NodeRec {
  id: string;
  parent: string | null;
  children: string[];
  holder: string | null;
  fence: number;
  nextFence: number;
  leaseDeadline: number;
  queue: Waiter[];
}

interface TicketRec {
  holderId: string;
  nodeId: string;
  waiting: boolean;
}

function compareWaiters(a: Waiter, b: Waiter): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
  return a.ticket - b.ticket;
}

export class NestLease {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxWaitersPerNode: number;
  private readonly nodes = new Map<string, NodeRec>();
  private readonly tickets = new Map<number, TicketRec>();
  private nextTicket = 1;

  constructor(options: NestLeaseOptions) {
    const { clock, leaseMs } = options;
    const maxWaitersPerNode = options.maxWaitersPerNode ?? 8;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isFinite(leaseMs) || leaseMs < 1) {
      throw new InvalidConfigError(`leaseMs must be >= 1, got ${leaseMs}`);
    }
    if (!Number.isInteger(maxWaitersPerNode) || maxWaitersPerNode < 1) {
      throw new InvalidConfigError(
        `maxWaitersPerNode must be an integer >= 1, got ${maxWaitersPerNode}`,
      );
    }
    this.clock = clock;
    this.leaseMs = leaseMs;
    this.maxWaitersPerNode = maxWaitersPerNode;
  }

  register(nodeId: string, parentId: string | null): void {
    if (typeof nodeId !== "string" || nodeId.length === 0) {
      throw new InvalidAcquireError("nodeId must be a non-empty string");
    }
    if (this.nodes.has(nodeId)) {
      throw new InvalidAcquireError(`node already registered: ${nodeId}`);
    }
    if (parentId !== null && !this.nodes.has(parentId)) {
      throw new UnknownNodeError(`unknown parent node: ${parentId}`);
    }
    const rec: NodeRec = {
      id: nodeId,
      parent: parentId,
      children: [],
      holder: null,
      fence: 0,
      nextFence: 1,
      leaseDeadline: 0,
      queue: [],
    };
    this.nodes.set(nodeId, rec);
    if (parentId !== null) {
      this.nodes.get(parentId)!.children.push(nodeId);
    }
  }

  parentOf(nodeId: string): string | null {
    return this.node(nodeId).parent;
  }

  childrenOf(nodeId: string): string[] {
    return [...this.node(nodeId).children].sort();
  }

  acquire(
    holderId: string,
    nodeId: string,
    opts: AcquireOptions = {},
  ): AcquireResult {
    if (typeof holderId !== "string" || holderId.length === 0) {
      throw new InvalidAcquireError("holderId must be a non-empty string");
    }
    if (typeof nodeId !== "string" || nodeId.length === 0) {
      throw new InvalidAcquireError("nodeId must be a non-empty string");
    }
    const rec = this.node(nodeId);
    if (this.hasForeignAncestor(rec, holderId)) {
      throw new InvalidAcquireError(
        `ancestor of ${nodeId} is held by another holder`,
      );
    }
    if (rec.holder === holderId) {
      throw new InvalidAcquireError(
        `${holderId} already holds ${nodeId}`,
      );
    }
    if (rec.queue.some((w) => w.holderId === holderId)) {
      throw new InvalidAcquireError(
        `${holderId} is already waiting on ${nodeId}`,
      );
    }
    if (rec.holder === null) {
      const fence = this.grant(rec, holderId);
      return { status: "granted", fence };
    }
    if (rec.queue.length >= this.maxWaitersPerNode) {
      throw new InvalidAcquireError(`wait queue of ${nodeId} is full`);
    }
    const waiter: Waiter = {
      ticket: this.nextTicket++,
      holderId,
      priority: opts.priority ?? 0,
      enqueuedAt: this.clock.now(),
    };
    rec.queue.push(waiter);
    rec.queue.sort(compareWaiters);
    this.tickets.set(waiter.ticket, {
      holderId,
      nodeId,
      waiting: true,
    });
    return { status: "waiting", ticket: waiter.ticket };
  }

  heartbeat(holderId: string, nodeId: string, fence: number): boolean {
    const rec = this.node(nodeId);
    if (rec.holder !== holderId) {
      return false;
    }
    if (rec.fence !== fence) {
      throw new FenceError(
        `fence mismatch on ${nodeId}: expected ${rec.fence}, got ${fence}`,
      );
    }
    rec.leaseDeadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(holderId: string, nodeId: string, fence: number): boolean {
    const rec = this.node(nodeId);
    if (rec.holder !== holderId) {
      return false;
    }
    if (this.holdsAnyDescendant(rec, holderId)) {
      throw new InvalidReleaseError(
        `${holderId} still holds a descendant of ${nodeId}`,
      );
    }
    if (rec.fence !== fence) {
      throw new FenceError(
        `fence mismatch on ${nodeId}: expected ${rec.fence}, got ${fence}`,
      );
    }
    rec.holder = null;
    this.promote(rec);
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const rec = this.tickets.get(ticket);
    if (!rec) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    if (rec.holderId !== holderId || !rec.waiting) {
      return false;
    }
    const node = this.nodes.get(rec.nodeId)!;
    node.queue = node.queue.filter((w) => w.ticket !== ticket);
    this.tickets.delete(ticket);
    return true;
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const expired = new Set<string>();
    for (const rec of this.nodes.values()) {
      if (rec.holder !== null && now >= rec.leaseDeadline) {
        expired.add(rec.id);
        this.collectHeldDescendants(rec, rec.holder, expired);
      }
    }
    for (const id of expired) {
      this.nodes.get(id)!.holder = null;
    }
    for (const rec of this.preorder()) {
      this.promote(rec);
    }
    return { expired: [...expired].sort() };
  }

  holderOf(nodeId: string): string | undefined {
    return this.node(nodeId).holder ?? undefined;
  }

  fenceOf(nodeId: string): number | undefined {
    const rec = this.node(nodeId);
    return rec.holder === null ? undefined : rec.fence;
  }

  waitingTickets(nodeId: string): number[] {
    return this.node(nodeId).queue.map((w) => w.ticket);
  }

  heldBy(holderId: string): string[] {
    const held: string[] = [];
    for (const rec of this.nodes.values()) {
      if (rec.holder === holderId) {
        held.push(rec.id);
      }
    }
    return held.sort();
  }

  private node(nodeId: string): NodeRec {
    const rec = this.nodes.get(nodeId);
    if (!rec) {
      throw new UnknownNodeError(`unknown node: ${nodeId}`);
    }
    return rec;
  }

  private grant(rec: NodeRec, holderId: string): number {
    const fence = rec.nextFence++;
    rec.holder = holderId;
    rec.fence = fence;
    rec.leaseDeadline = this.clock.now() + this.leaseMs;
    return fence;
  }

  private hasForeignAncestor(rec: NodeRec, holderId: string): boolean {
    let cursor = rec.parent;
    while (cursor !== null) {
      const ancestor = this.nodes.get(cursor)!;
      if (ancestor.holder !== null && ancestor.holder !== holderId) {
        return true;
      }
      cursor = ancestor.parent;
    }
    return false;
  }

  private holdsAnyDescendant(rec: NodeRec, holderId: string): boolean {
    for (const childId of rec.children) {
      const child = this.nodes.get(childId)!;
      if (child.holder === holderId || this.holdsAnyDescendant(child, holderId)) {
        return true;
      }
    }
    return false;
  }

  private collectHeldDescendants(
    rec: NodeRec,
    holderId: string,
    out: Set<string>,
  ): void {
    for (const childId of rec.children) {
      const child = this.nodes.get(childId)!;
      if (child.holder === holderId) {
        out.add(child.id);
        this.collectHeldDescendants(child, holderId, out);
      }
    }
  }

  private promote(rec: NodeRec): void {
    if (rec.holder !== null) {
      return;
    }
    for (const waiter of rec.queue) {
      if (this.hasForeignAncestor(rec, waiter.holderId)) {
        continue;
      }
      rec.queue = rec.queue.filter((w) => w.ticket !== waiter.ticket);
      const ticket = this.tickets.get(waiter.ticket);
      if (ticket) {
        ticket.waiting = false;
      }
      this.grant(rec, waiter.holderId);
      return;
    }
  }

  private preorder(): NodeRec[] {
    const out: NodeRec[] = [];
    const roots: string[] = [];
    for (const rec of this.nodes.values()) {
      if (rec.parent === null) {
        roots.push(rec.id);
      }
    }
    roots.sort();
    const visit = (id: string): void => {
      const rec = this.nodes.get(id)!;
      out.push(rec);
      for (const childId of [...rec.children].sort()) {
        visit(childId);
      }
    };
    for (const rootId of roots) {
      visit(rootId);
    }
    return out;
  }
}
