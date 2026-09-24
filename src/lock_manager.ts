import type { Clock, HeldLock, LockMode, ResourceId, TxnId, TxnStatus } from "./types.js";

interface WaitRequest {
  txnId: TxnId;
  mode: LockMode;
  startMs: number;
  timeoutMs?: number;
}

interface ResourceState {
  holders: Map<TxnId, LockMode>;
  queue: WaitRequest[];
}

/**
 * 多资源锁管理器。
 */
export class LockManager {
  private readonly resources = new Map<ResourceId, ResourceState>();
  private readonly statuses = new Map<TxnId, TxnStatus>();
  private readonly heldLocks = new Map<TxnId, Map<ResourceId, LockMode>>();

  constructor(private readonly clock: Clock) {}

  begin(txnId: TxnId): void {
    const st = this.statuses.get(txnId);
    if (st === "active" || st === "waiting") {
      throw new Error(`txn ${txnId} already begun`);
    }
    this.statuses.set(txnId, "active");
    this.heldLocks.set(txnId, new Map());
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
    const st = this.statuses.get(txnId);
    if (st === undefined) {
      throw new Error(`unknown txn ${txnId}`);
    }
    if (st === "aborted" || st === "committed") {
      throw new Error(`txn ${txnId} is ${st}; cannot acquire locks`);
    }

    const rs = this.resourceState(resource);
    const heldMode = rs.holders.get(txnId);
    if (heldMode !== undefined) {
      // 可重入：已持有兼容模式直接成功。
      if (heldMode === "X" || mode === "S") {
        return "granted";
      }
      // S -> X 升级：无其他持有者时立即升级。
      if (this.countOtherHolders(rs, txnId) === 0) {
        rs.holders.set(txnId, "X");
        this.heldLocks.get(txnId)!.set(resource, "X");
        return "granted";
      }
      if (rs.queue.some((q) => q.txnId === txnId)) {
        return "waiting";
      }
    } else if (rs.queue.length === 0 && this.compatible(rs, txnId, mode)) {
      this.grant(rs, txnId, resource, mode);
      return "granted";
    } else if (rs.queue.some((q) => q.txnId === txnId)) {
      return "waiting";
    }

    rs.queue.push({ txnId, mode, startMs: this.clock.nowMs(), timeoutMs });
    this.refreshStatus(txnId);
    this.resolveDeadlocks();

    if (this.statuses.get(txnId) === "aborted") {
      throw new Error(`txn ${txnId} aborted: deadlock victim`);
    }
    return this.isWaiting(txnId) ? "waiting" : "granted";
  }

  /** 推进时钟后调用，处理超时并尽量授予队首。 */
  tick(): void {
    const now = this.clock.nowMs();
    const timedOut = new Set<TxnId>();
    for (const rs of this.resources.values()) {
      for (const req of rs.queue) {
        if (req.timeoutMs !== undefined && now - req.startMs >= req.timeoutMs) {
          timedOut.add(req.txnId);
        }
      }
    }
    for (const txnId of timedOut) {
      this.terminate(txnId, "aborted");
    }
  }

  commit(txnId: TxnId): void {
    this.terminate(txnId, "committed");
  }

  abort(txnId: TxnId): void {
    this.terminate(txnId, "aborted");
  }

  crash(txnId: TxnId): void {
    this.terminate(txnId, "aborted");
  }

  status(txnId: TxnId): TxnStatus {
    const st = this.statuses.get(txnId);
    if (st === undefined) {
      throw new Error(`unknown txn ${txnId}`);
    }
    return st;
  }

  held(txnId: TxnId): HeldLock[] {
    const locks = this.heldLocks.get(txnId);
    if (!locks) {
      return [];
    }
    return [...locks.entries()].map(([resource, mode]) => ({ resource, mode }));
  }

  private resourceState(resource: ResourceId): ResourceState {
    let rs = this.resources.get(resource);
    if (!rs) {
      rs = { holders: new Map(), queue: [] };
      this.resources.set(resource, rs);
    }
    return rs;
  }

  private countOtherHolders(rs: ResourceState, txnId: TxnId): number {
    let count = 0;
    for (const holder of rs.holders.keys()) {
      if (holder !== txnId) {
        count += 1;
      }
    }
    return count;
  }

  private compatible(rs: ResourceState, txnId: TxnId, mode: LockMode): boolean {
    for (const [holder, holderMode] of rs.holders) {
      if (holder === txnId) {
        continue;
      }
      if (mode === "X" || holderMode === "X") {
        return false;
      }
    }
    return true;
  }

  private grant(rs: ResourceState, txnId: TxnId, resource: ResourceId, mode: LockMode): void {
    rs.holders.set(txnId, mode);
    let locks = this.heldLocks.get(txnId);
    if (!locks) {
      locks = new Map();
      this.heldLocks.set(txnId, locks);
    }
    locks.set(resource, mode);
  }

  /** 释放后从队首开始尽量授予，遇到不兼容的队首即停止，不允许插队。 */
  private grantFromQueue(resource: ResourceId): void {
    const rs = this.resources.get(resource);
    if (!rs) {
      return;
    }
    while (rs.queue.length > 0) {
      const head = rs.queue[0];
      if (!this.compatible(rs, head.txnId, head.mode)) {
        break;
      }
      rs.queue.shift();
      this.grant(rs, head.txnId, resource, head.mode);
      this.refreshStatus(head.txnId);
    }
  }

  private grantAll(): void {
    for (const resource of this.resources.keys()) {
      this.grantFromQueue(resource);
    }
  }

  private isWaiting(txnId: TxnId): boolean {
    for (const rs of this.resources.values()) {
      if (rs.queue.some((q) => q.txnId === txnId)) {
        return true;
      }
    }
    return false;
  }

  private refreshStatus(txnId: TxnId): void {
    const st = this.statuses.get(txnId);
    if (st !== "active" && st !== "waiting") {
      return;
    }
    this.statuses.set(txnId, this.isWaiting(txnId) ? "waiting" : "active");
  }

  /** 释放事务全部锁、移出所有队列、设置终态并唤醒兼容等待者。 */
  private terminate(txnId: TxnId, final: "committed" | "aborted"): void {
    if (!this.statuses.has(txnId)) {
      throw new Error(`unknown txn ${txnId}`);
    }
    for (const [resource, rs] of this.resources) {
      rs.holders.delete(txnId);
      rs.queue = rs.queue.filter((q) => q.txnId !== txnId);
      if (rs.holders.size === 0 && rs.queue.length === 0) {
        this.resources.delete(resource);
      }
    }
    this.heldLocks.set(txnId, new Map());
    this.statuses.set(txnId, final);
    this.grantAll();
  }

  /** 等待图成环时，中止环中 txnId 字典序最大的事务，直到无环。 */
  private resolveDeadlocks(): void {
    for (;;) {
      const cycle = this.findCycle();
      if (!cycle) {
        return;
      }
      let victim = cycle[0];
      for (const id of cycle) {
        if (id > victim) {
          victim = id;
        }
      }
      this.terminate(victim, "aborted");
    }
  }

  private buildWaitsFor(): Map<TxnId, TxnId[]> {
    const graph = new Map<TxnId, TxnId[]>();
    for (const rs of this.resources.values()) {
      for (const req of rs.queue) {
        let edges = graph.get(req.txnId);
        if (!edges) {
          edges = [];
          graph.set(req.txnId, edges);
        }
        for (const holder of rs.holders.keys()) {
          if (holder !== req.txnId && !edges.includes(holder)) {
            edges.push(holder);
          }
        }
      }
    }
    return graph;
  }

  private findCycle(): TxnId[] | null {
    const graph = this.buildWaitsFor();
    const visited = new Set<TxnId>();
    const inStack = new Set<TxnId>();
    const stack: TxnId[] = [];

    const dfs = (node: TxnId): TxnId[] | null => {
      visited.add(node);
      inStack.add(node);
      stack.push(node);
      for (const next of graph.get(node) ?? []) {
        if (!visited.has(next)) {
          const cycle = dfs(next);
          if (cycle) {
            return cycle;
          }
        } else if (inStack.has(next)) {
          return stack.slice(stack.indexOf(next));
        }
      }
      stack.pop();
      inStack.delete(node);
      return null;
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        const cycle = dfs(node);
        if (cycle) {
          return cycle;
        }
      }
    }
    return null;
  }
}
