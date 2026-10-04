export class NestLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends NestLeaseError {}
export class UnknownNodeError extends NestLeaseError {}
export class InvalidAcquireError extends NestLeaseError {}
export class InvalidReleaseError extends NestLeaseError {}
export class FenceError extends NestLeaseError {}
export class UnknownTicketError extends NestLeaseError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new NestLeaseError("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}

export interface NestLeaseOptions {
  clock: VirtualClock;
  leaseMs: number;
  maxWaitersPerNode?: number;
}

export type AcquireResult =
  | { status: "granted"; fence: number }
  | { status: "waiting"; ticket: number };

export interface DriveReport {
  expired: string[];
}

interface Hold {
  holder: string;
  fence: number;
  deadline: number;
}

interface Waiter {
  ticket: number;
  holder: string;
  priority: number;
  enqueuedAt: number;
}

interface TreeNode {
  id: string;
  parent: string | null;
  children: string[];
  hold: Hold | undefined;
  waiters: Waiter[];
  nextFence: number;
}

interface TicketRecord {
  holder: string;
  nodeId: string;
  waiting: boolean;
}

function waiterCompare(a: Waiter, b: Waiter): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
  return a.ticket - b.ticket;
}

export class NestLease {
  private readonly clock: VirtualClock;
  private readonly leaseMs: number;
  private readonly maxWaitersPerNode: number;
  private readonly nodes = new Map<string, TreeNode>();
  private readonly roots: string[] = [];
  private readonly tickets = new Map<number, TicketRecord>();
  private ticketCounter = 0;

  constructor(options: NestLeaseOptions) {
    if (
      !options ||
      !(options.clock instanceof VirtualClock) ||
      typeof options.leaseMs !== "number" ||
      !Number.isFinite(options.leaseMs) ||
      options.leaseMs < 1
    ) {
      throw new InvalidConfigError("leaseMs must be a finite number >= 1");
    }
    const maxWaiters = options.maxWaitersPerNode ?? 8;
    if (!Number.isInteger(maxWaiters) || maxWaiters < 1) {
      throw new InvalidConfigError("maxWaitersPerNode must be an integer >= 1");
    }
    this.clock = options.clock;
    this.leaseMs = options.leaseMs;
    this.maxWaitersPerNode = maxWaiters;
  }

  register(nodeId: string, parentId: string | null): void {
    if (!nodeId) {
      throw new InvalidAcquireError("nodeId must be non-empty");
    }
    if (this.nodes.has(nodeId)) {
      throw new InvalidAcquireError(`node already registered: ${nodeId}`);
    }
    let parent: TreeNode | undefined;
    if (parentId !== null) {
      parent = this.nodes.get(parentId);
      if (!parent) {
        throw new UnknownNodeError(`unknown parent node: ${parentId}`);
      }
    }
    const node: TreeNode = {
      id: nodeId,
      parent: parentId,
      children: [],
      hold: undefined,
      waiters: [],
      nextFence: 1,
    };
    this.nodes.set(nodeId, node);
    const siblings = parent ? parent.children : this.roots;
    siblings.push(nodeId);
    siblings.sort();
  }

  parentOf(nodeId: string): string | null {
    return this.requireNode(nodeId).parent;
  }

  childrenOf(nodeId: string): string[] {
    return [...this.requireNode(nodeId).children];
  }

  acquire(
    holderId: string,
    nodeId: string,
    opts?: { priority?: number },
  ): AcquireResult {
    if (!holderId || !nodeId) {
      throw new InvalidAcquireError("holderId and nodeId must be non-empty");
    }
    const node = this.requireNode(nodeId);
    if (node.hold && node.hold.holder === holderId) {
      throw new InvalidAcquireError(`holder already holds node: ${nodeId}`);
    }
    if (node.waiters.some((w) => w.holder === holderId)) {
      throw new InvalidAcquireError(`holder already waiting on node: ${nodeId}`);
    }
    if (this.ancestorHeldByOther(node, holderId)) {
      throw new InvalidAcquireError(
        `an ancestor of ${nodeId} is held by another holder`,
      );
    }
    if (!node.hold) {
      const fence = node.nextFence++;
      node.hold = {
        holder: holderId,
        fence,
        deadline: this.clock.now() + this.leaseMs,
      };
      return { status: "granted", fence };
    }
    if (node.waiters.length >= this.maxWaitersPerNode) {
      throw new InvalidAcquireError(`wait queue full on node: ${nodeId}`);
    }
    const ticket = ++this.ticketCounter;
    const waiter: Waiter = {
      ticket,
      holder: holderId,
      priority: opts?.priority ?? 0,
      enqueuedAt: this.clock.now(),
    };
    node.waiters.push(waiter);
    node.waiters.sort(waiterCompare);
    this.tickets.set(ticket, { holder: holderId, nodeId, waiting: true });
    return { status: "waiting", ticket };
  }

  heartbeat(holderId: string, nodeId: string, fence: number): boolean {
    const node = this.requireNode(nodeId);
    const hold = node.hold;
    if (!hold || hold.holder !== holderId) {
      return false;
    }
    if (hold.fence !== fence) {
      throw new FenceError(`fence mismatch on node: ${nodeId}`);
    }
    hold.deadline = this.clock.now() + this.leaseMs;
    return true;
  }

  release(holderId: string, nodeId: string, fence: number): boolean {
    const node = this.requireNode(nodeId);
    const hold = node.hold;
    if (!hold || hold.holder !== holderId) {
      return false;
    }
    if (hold.fence !== fence) {
      throw new FenceError(`fence mismatch on node: ${nodeId}`);
    }
    if (this.holdsAnyDescendant(node, holderId)) {
      throw new InvalidReleaseError(
        `holder still holds a descendant of node: ${nodeId}`,
      );
    }
    node.hold = undefined;
    this.promote(node);
    return true;
  }

  cancelWait(holderId: string, ticket: number): boolean {
    const record = this.tickets.get(ticket);
    if (!record) {
      throw new UnknownTicketError(`unknown ticket: ${ticket}`);
    }
    if (record.holder !== holderId) {
      return false;
    }
    if (!record.waiting) {
      return false;
    }
    const node = this.nodes.get(record.nodeId);
    if (node) {
      node.waiters = node.waiters.filter((w) => w.ticket !== ticket);
    }
    this.tickets.delete(ticket);
    return true;
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const expired = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.hold && now >= node.hold.deadline) {
        this.collectHeldSubtree(node, node.hold.holder, expired);
      }
    }
    for (const id of expired) {
      const node = this.nodes.get(id);
      if (node) node.hold = undefined;
    }
    for (const id of this.preorderIds()) {
      const node = this.nodes.get(id);
      if (node && !node.hold && node.waiters.length > 0) {
        this.promote(node);
      }
    }
    return { expired: [...expired].sort() };
  }

  holderOf(nodeId: string): string | undefined {
    return this.requireNode(nodeId).hold?.holder;
  }

  fenceOf(nodeId: string): number | undefined {
    return this.requireNode(nodeId).hold?.fence;
  }

  waitingTickets(nodeId: string): number[] {
    return this.requireNode(nodeId).waiters.map((w) => w.ticket);
  }

  heldBy(holderId: string): string[] {
    const held: string[] = [];
    for (const node of this.nodes.values()) {
      if (node.hold && node.hold.holder === holderId) {
        held.push(node.id);
      }
    }
    return held.sort();
  }

  private requireNode(nodeId: string): TreeNode {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new UnknownNodeError(`unknown node: ${nodeId}`);
    }
    return node;
  }

  private ancestorHeldByOther(node: TreeNode, holderId: string): boolean {
    let cursor = node.parent;
    while (cursor !== null) {
      const ancestor = this.nodes.get(cursor);
      if (!ancestor) break;
      if (ancestor.hold && ancestor.hold.holder !== holderId) {
        return true;
      }
      cursor = ancestor.parent;
    }
    return false;
  }

  private holdsAnyDescendant(node: TreeNode, holderId: string): boolean {
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      if (!child) continue;
      if (child.hold && child.hold.holder === holderId) return true;
      if (this.holdsAnyDescendant(child, holderId)) return true;
    }
    return false;
  }

  private collectHeldSubtree(
    node: TreeNode,
    holderId: string,
    out: Set<string>,
  ): void {
    if (node.hold && node.hold.holder === holderId) {
      out.add(node.id);
    }
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      if (child) this.collectHeldSubtree(child, holderId, out);
    }
  }

  private promote(node: TreeNode): void {
    if (node.hold) return;
    for (const waiter of [...node.waiters]) {
      if (node.hold) break;
      if (this.ancestorHeldByOther(node, waiter.holder)) continue;
      node.waiters = node.waiters.filter((w) => w.ticket !== waiter.ticket);
      const fence = node.nextFence++;
      node.hold = {
        holder: waiter.holder,
        fence,
        deadline: this.clock.now() + this.leaseMs,
      };
      const record = this.tickets.get(waiter.ticket);
      if (record) record.waiting = false;
    }
  }

  private preorderIds(): string[] {
    const out: string[] = [];
    const visit = (id: string): void => {
      const node = this.nodes.get(id);
      if (!node) return;
      out.push(id);
      for (const childId of node.children) visit(childId);
    };
    for (const rootId of this.roots) visit(rootId);
    return out;
  }
}
