import type { GranLockOptions, LockMode } from "./types.js";
import { compatible, covers, intentionFor, mergeModes } from "./compat.js";
import { DeadlockError, InvalidIdError } from "./errors.js";
import { WaitQueues } from "./queue.js";
import { ResourceTree } from "./tree.js";
import { WaitForGraph } from "./waits.js";

export class GranLock {
  private readonly tree: ResourceTree;
  private readonly queues = new WaitQueues();
  private readonly graph = new WaitForGraph();
  /** resourceId → (txnId → granted mode) */
  private readonly granted = new Map<string, Map<string, LockMode>>();
  private readonly txns: string[] = [];
  private readonly txnSet = new Set<string>();

  constructor(opts: GranLockOptions) {
    this.tree = new ResourceTree(opts.resources);
  }

  begin(): string {
    const id = `t${this.txns.length + 1}`;
    this.txns.push(id);
    this.txnSet.add(id);
    return id;
  }

  acquire(txnId: string, resourceId: string, mode: LockMode): "granted" | "waiting" {
    this.checkTxn(txnId);
    this.checkResource(resourceId);
    const intention = intentionFor(mode);
    const chain: Array<[string, LockMode]> = this.tree
      .ancestors(resourceId)
      .map((id) => [id, intention]);
    chain.push([resourceId, mode]);
    for (const [res, need] of chain) {
      if (this.acquireOne(txnId, res, need) === "waiting") return "waiting";
    }
    return "granted";
  }

  release(txnId: string, resourceId: string): void {
    this.checkTxn(txnId);
    this.checkResource(resourceId);
    const holders = this.granted.get(resourceId);
    if (holders) {
      holders.delete(txnId);
      if (holders.size === 0) this.granted.delete(resourceId);
    }
    this.wake(resourceId);
    this.rebuildGraph();
  }

  releaseAll(txnId: string): void {
    this.checkTxn(txnId);
    for (const [res, holders] of [...this.granted]) {
      holders.delete(txnId);
      if (holders.size === 0) this.granted.delete(res);
    }
    this.queues.removeTxn(txnId);
    for (const res of this.tree.ids()) this.wake(res);
    this.rebuildGraph();
  }

  modeOf(txnId: string, resourceId: string): LockMode | null {
    this.checkTxn(txnId);
    this.checkResource(resourceId);
    return this.granted.get(resourceId)?.get(txnId) ?? null;
  }

  holders(resourceId: string): Array<{ txnId: string; mode: LockMode }> {
    this.checkResource(resourceId);
    const holders = this.granted.get(resourceId);
    if (!holders) return [];
    return [...holders].map(([id, mode]) => ({ txnId: id, mode }));
  }

  waiters(resourceId: string): Array<{ txnId: string; mode: LockMode }> {
    this.checkResource(resourceId);
    return this.queues.list(resourceId).map((r) => ({ ...r }));
  }

  activeTxns(): string[] {
    return [...this.txns];
  }

  private acquireOne(txnId: string, resourceId: string, mode: LockMode): "granted" | "waiting" {
    let holders = this.granted.get(resourceId);
    if (!holders) {
      holders = new Map();
      this.granted.set(resourceId, holders);
    }
    const current = holders.get(txnId);
    if (current !== undefined && covers(current, mode)) return "granted";
    const target = current === undefined ? mode : mergeModes(current, mode);
    const conflicts: string[] = [];
    for (const [otherTxn, otherMode] of holders) {
      if (otherTxn !== txnId && !compatible(otherMode, target)) conflicts.push(otherTxn);
    }
    if (conflicts.length === 0) {
      holders.set(txnId, target);
      return "granted";
    }
    // Replace any stale queued request from this txn on this resource.
    if (this.queues.remove(resourceId, txnId)) this.rebuildGraph();
    if (this.graph.wouldCreateCycle(txnId, conflicts)) {
      throw new DeadlockError(`deadlock: txn ${txnId} waiting on ${resourceId}`);
    }
    this.queues.enqueue(resourceId, { txnId, mode: target });
    for (const c of conflicts) this.graph.addEdge(txnId, c);
    return "waiting";
  }

  /** Grant the compatible prefix of the FIFO queue on one resource. */
  private wake(resourceId: string): void {
    let holders = this.granted.get(resourceId);
    if (!holders) {
      holders = new Map();
      this.granted.set(resourceId, holders);
    }
    for (;;) {
      const head = this.queues.peek(resourceId);
      if (!head) break;
      let ok = true;
      for (const [otherTxn, otherMode] of holders) {
        if (otherTxn !== head.txnId && !compatible(otherMode, head.mode)) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      this.queues.dequeue(resourceId);
      holders.set(head.txnId, head.mode);
    }
    if (holders.size === 0) this.granted.delete(resourceId);
  }

  /** Recompute waits-for edges from current queues and holders. */
  private rebuildGraph(): void {
    this.graph.clear();
    for (const res of this.tree.ids()) {
      const holders = this.granted.get(res);
      if (!holders) continue;
      for (const w of this.queues.list(res)) {
        for (const [otherTxn, otherMode] of holders) {
          if (otherTxn !== w.txnId && !compatible(otherMode, w.mode)) {
            this.graph.addEdge(w.txnId, otherTxn);
          }
        }
      }
    }
  }

  private checkTxn(txnId: string): void {
    if (!this.txnSet.has(txnId)) throw new InvalidIdError(`unknown txn: ${txnId}`);
  }

  private checkResource(resourceId: string): void {
    if (!this.tree.has(resourceId)) {
      throw new InvalidIdError(`unknown resource: ${resourceId}`);
    }
  }
}
