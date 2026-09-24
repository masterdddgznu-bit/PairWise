import type { Clock, HeldLock, LockMode, ResourceId, TxnId, TxnStatus } from "./types.js";

interface WaitEntry {
  txnId: TxnId;
  mode: LockMode;
  deadline: number | undefined;
}

interface ResourceState {
  holders: Map<TxnId, LockMode>;
  queue: WaitEntry[];
}

interface TxnInfo {
  status: TxnStatus;
  held: Map<ResourceId, LockMode>;
  waitingOn: Set<ResourceId>;
}

/**
 * 多资源锁管理器。起始实现未完成。
 */
export class LockManager {
  private readonly txns = new Map<TxnId, TxnInfo>();
  private readonly resources = new Map<ResourceId, ResourceState>();

  constructor(private readonly clock: Clock) {}

  begin(txnId: TxnId): void {
    if (this.txns.has(txnId)) {
      throw new Error(`transaction already exists: ${txnId}`);
    }
    this.txns.set(txnId, {
      status: "active",
      held: new Map(),
      waitingOn: new Set(),
    });
  }

  /**
   * 申请锁。立即获得返回 "granted"；进入等待返回 "waiting"。
   * 死锁或超时导致本事务被中止时抛错。
   */
  lock(
    txnId: TxnId,
    resource: ResourceId,
    mode: LockMode,
    timeoutMs?: number,
  ): "granted" | "waiting" {
    const txn = this.requireTxn(txnId);
    if (txn.status === "aborted") {
      throw new Error(`transaction ${txnId} is aborted`);
    }
    if (txn.status === "committed") {
      throw new Error(`transaction ${txnId} is committed`);
    }
    if (txn.waitingOn.has(resource)) {
      return "waiting";
    }

    const heldMode = txn.held.get(resource);
    if (heldMode !== undefined) {
      if (heldMode === "X" || mode === "S") {
        return "granted";
      }
      // S -> X upgrade
      const res = this.resources.get(resource)!;
      if (this.onlyHolder(res, txnId)) {
        res.holders.set(txnId, "X");
        txn.held.set(resource, "X");
        return "granted";
      }
      this.enqueue(resource, res, txnId, mode, timeoutMs, txn);
      return this.afterWait(resource, txnId, txn);
    }

    let res = this.resources.get(resource);
    if (res === undefined) {
      res = { holders: new Map(), queue: [] };
      this.resources.set(resource, res);
    }

    if (res.queue.length === 0 && this.compatibleWithHolders(res, mode, txnId)) {
      res.holders.set(txnId, mode);
      txn.held.set(resource, mode);
      return "granted";
    }

    this.enqueue(resource, res, txnId, mode, timeoutMs, txn);
    return this.afterWait(resource, txnId, txn);
  }

  /** 推进时钟后调用，处理超时并尽量授予队首。 */
  tick(): void {
    for (const resource of this.resources.keys()) {
      this.processQueue(resource);
    }
  }

  commit(txnId: TxnId): void {
    const txn = this.requireTxn(txnId);
    this.finish(txnId, txn, "committed");
  }

  abort(txnId: TxnId): void {
    const txn = this.requireTxn(txnId);
    this.finish(txnId, txn, "aborted");
  }

  crash(txnId: TxnId): void {
    const txn = this.requireTxn(txnId);
    this.finish(txnId, txn, "aborted");
  }

  status(txnId: TxnId): TxnStatus {
    return this.requireTxn(txnId).status;
  }

  held(txnId: TxnId): HeldLock[] {
    const txn = this.txns.get(txnId);
    if (txn === undefined) {
      return [];
    }
    return [...txn.held.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([resource, mode]) => ({ resource, mode }));
  }

  private requireTxn(txnId: TxnId): TxnInfo {
    const txn = this.txns.get(txnId);
    if (txn === undefined) {
      throw new Error(`unknown transaction: ${txnId}`);
    }
    return txn;
  }

  private onlyHolder(res: ResourceState, txnId: TxnId): boolean {
    for (const holder of res.holders.keys()) {
      if (holder !== txnId) {
        return false;
      }
    }
    return true;
  }

  private compatibleWithHolders(
    res: ResourceState,
    mode: LockMode,
    self: TxnId,
  ): boolean {
    for (const [holder, heldMode] of res.holders) {
      if (holder === self) {
        continue;
      }
      if (mode === "X" || heldMode === "X") {
        return false;
      }
    }
    return true;
  }

  private enqueue(
    resource: ResourceId,
    res: ResourceState,
    txnId: TxnId,
    mode: LockMode,
    timeoutMs: number | undefined,
    txn: TxnInfo,
  ): void {
    const deadline =
      timeoutMs === undefined ? undefined : this.clock.nowMs() + timeoutMs;
    res.queue.push({ txnId, mode, deadline });
    txn.waitingOn.add(resource);
    txn.status = "waiting";
  }

  /** 入队后检测死锁并返回本次申请的结果。 */
  private afterWait(
    resource: ResourceId,
    txnId: TxnId,
    txn: TxnInfo,
  ): "granted" | "waiting" {
    const victim = this.findCycleVictim(txnId);
    if (victim !== undefined) {
      if (victim === txnId) {
        this.abortInternal(txnId);
        throw new Error(`deadlock detected, transaction ${txnId} aborted`);
      }
      this.abortInternal(victim);
    }
    return txn.waitingOn.has(resource) ? "waiting" : "granted";
  }

  /**
   * 构建等待图：等待者 u 等待某资源时，边指向该资源的其他持有者以及
   * 队列中排在 u 前面的请求者（FIFO 下它们都会阻止 u 获得锁）。
   */
  private buildWaitEdges(): Map<TxnId, Set<TxnId>> {
    const edges = new Map<TxnId, Set<TxnId>>();
    for (const res of this.resources.values()) {
      for (let i = 0; i < res.queue.length; i++) {
        const waiter = res.queue[i].txnId;
        let set = edges.get(waiter);
        if (set === undefined) {
          set = new Set();
          edges.set(waiter, set);
        }
        for (const holder of res.holders.keys()) {
          if (holder !== waiter) {
            set.add(holder);
          }
        }
        for (let j = 0; j < i; j++) {
          set.add(res.queue[j].txnId);
        }
      }
    }
    return edges;
  }

  /**
   * 若从 start 出发会形成环，返回环中字典序最大的事务；否则 undefined。
   * 环上的节点 = start 在等待图上可达的节点 ∩ 可到达 start 的节点。
   */
  private findCycleVictim(start: TxnId): TxnId | undefined {
    const edges = this.buildWaitEdges();
    const forward = this.successors(start, edges);
    if (!forward.has(start)) {
      return undefined;
    }
    const reverse = new Map<TxnId, TxnId[]>();
    for (const [from, tos] of edges) {
      for (const to of tos) {
        let list = reverse.get(to);
        if (list === undefined) {
          list = [];
          reverse.set(to, list);
        }
        list.push(from);
      }
    }
    const backward = this.successors(start, reverse);
    let victim: TxnId | undefined;
    for (const node of forward) {
      if (backward.has(node)) {
        if (victim === undefined || node > victim) {
          victim = node;
        }
      }
    }
    return victim;
  }

  /** 沿边从 start 出发可到达的节点（不含 start 自身，除非经由环回到）。 */
  private successors(
    start: TxnId,
    edges: Map<TxnId, Iterable<TxnId>>,
  ): Set<TxnId> {
    const seen = new Set<TxnId>();
    const stack: TxnId[] = [];
    const first = edges.get(start);
    if (first !== undefined) {
      for (const target of first) {
        stack.push(target);
      }
    }
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (seen.has(node)) {
        continue;
      }
      seen.add(node);
      const next = edges.get(node);
      if (next !== undefined) {
        for (const target of next) {
          if (!seen.has(target)) {
            stack.push(target);
          }
        }
      }
    }
    return seen;
  }

  /** 中止事务：移出所有队列、释放全部锁，然后唤醒后续兼容等待者。 */
  private abortInternal(victim: TxnId): void {
    const txn = this.txns.get(victim);
    if (txn === undefined) {
      return;
    }

    const affected = new Set<ResourceId>();
    for (const resource of txn.waitingOn) {
      affected.add(resource);
    }
    for (const resource of txn.held.keys()) {
      affected.add(resource);
    }

    for (const resource of affected) {
      const res = this.resources.get(resource);
      if (res !== undefined) {
        res.queue = res.queue.filter((entry) => entry.txnId !== victim);
      }
    }
    txn.waitingOn.clear();

    for (const resource of txn.held.keys()) {
      const res = this.resources.get(resource);
      res?.holders.delete(victim);
    }
    txn.held.clear();
    txn.status = "aborted";

    for (const resource of affected) {
      this.processQueue(resource);
    }
  }

  private finish(
    txnId: TxnId,
    txn: TxnInfo,
    status: "committed" | "aborted",
  ): void {
    if (txn.status === "committed" || txn.status === "aborted") {
      return;
    }

    const affected = new Set<ResourceId>();
    for (const resource of txn.waitingOn) {
      affected.add(resource);
    }
    for (const resource of txn.held.keys()) {
      affected.add(resource);
    }

    for (const resource of affected) {
      const res = this.resources.get(resource);
      if (res !== undefined) {
        res.queue = res.queue.filter((entry) => entry.txnId !== txnId);
      }
    }
    txn.waitingOn.clear();

    for (const resource of txn.held.keys()) {
      const res = this.resources.get(resource);
      res?.holders.delete(txnId);
    }
    txn.held.clear();
    txn.status = status;

    for (const resource of affected) {
      this.processQueue(resource);
    }
  }

  /** FIFO 处理：超时先中止，随后只授予连续兼容的队首。 */
  private processQueue(resource: ResourceId): void {
    const res = this.resources.get(resource);
    if (res === undefined) {
      return;
    }

    while (res.queue.length > 0) {
      const head = res.queue[0];

      if (head.deadline !== undefined && this.clock.nowMs() >= head.deadline) {
        this.abortInternal(head.txnId);
        return;
      }

      if (!this.compatibleWithHolders(res, head.mode, head.txnId)) {
        return;
      }

      res.queue.shift();
      const txn = this.txns.get(head.txnId);
      const current = res.holders.get(head.txnId);
      const grantedMode = current === "X" || head.mode === "X" ? "X" : "S";
      res.holders.set(head.txnId, grantedMode);
      if (txn !== undefined) {
        txn.held.set(resource, grantedMode);
        txn.waitingOn.delete(resource);
        if (txn.waitingOn.size === 0) {
          txn.status = "active";
        }
      }
    }
  }
}
