import type { GranLockOptions, LockMode } from "./types.js";
import { compatible, covers, intentionFor } from "./compat.js";
import { DeadlockError, InvalidIdError } from "./errors.js";
import { WaitQueues } from "./queue.js";
import { ResourceTree } from "./tree.js";
import { WaitForGraph } from "./waits.js";

export class GranLock {
  private readonly tree: ResourceTree;
  private readonly queues = new WaitQueues();
  private readonly waits = new WaitForGraph();
  /** resourceId -> (txnId -> granted mode) */
  private readonly held = new Map<string, Map<string, LockMode>>();
  private readonly txns: string[] = [];
  private readonly txnSet = new Set<string>();
  private nextId = 0;

  constructor(opts: GranLockOptions) {
    this.tree = new ResourceTree(opts.resources);
  }

  begin(): string {
    this.nextId += 1;
    const id = `t${this.nextId}`;
    this.txns.push(id);
    this.txnSet.add(id);
    return id;
  }

  acquire(txnId: string, resourceId: string, mode: LockMode): "granted" | "waiting" {
    this.assertTxn(txnId);
    this.assertResource(resourceId);
    const intention = intentionFor(mode);
    for (const ancestor of this.tree.ancestors(resourceId)) {
      if (this.acquireOne(txnId, ancestor, intention) === "waiting") {
        return "waiting";
      }
    }
    return this.acquireOne(txnId, resourceId, mode);
  }

  private acquireOne(txnId: string, resourceId: string, mode: LockMode): "granted" | "waiting" {
    const holders = this.holderMap(resourceId);
    const current = holders.get(txnId);
    if (current !== undefined && covers(current, mode)) {
      return "granted";
    }
    const conflicts: string[] = [];
    for (const [other, heldMode] of holders) {
      if (other !== txnId && !compatible(heldMode, mode)) {
        conflicts.push(other);
      }
    }
    if (conflicts.length === 0) {
      holders.set(txnId, mode);
      return "granted";
    }
    if (this.waits.wouldCreateCycle(txnId, conflicts)) {
      throw new DeadlockError();
    }
    for (const other of conflicts) {
      this.waits.addEdge(txnId, other);
    }
    this.queues.enqueue(resourceId, { txnId, mode });
    return "waiting";
  }

  release(txnId: string, resourceId: string): void {
    this.assertTxn(txnId);
    this.assertResource(resourceId);
    this.held.get(resourceId)?.delete(txnId);
    this.queues.remove(resourceId, txnId);
    this.waits.removeEdgesFrom(txnId);
    this.drain(resourceId);
  }

  releaseAll(txnId: string): void {
    this.assertTxn(txnId);
    const affected: string[] = [];
    for (const [resourceId, holders] of this.held) {
      if (holders.delete(txnId)) {
        affected.push(resourceId);
      }
    }
    this.queues.removeTxn(txnId);
    this.waits.removeEdgesFrom(txnId);
    for (const resourceId of affected) {
      this.drain(resourceId);
    }
  }

  /** Grant the compatible prefix of the resource's FIFO queue. */
  private drain(resourceId: string): void {
    const holders = this.holderMap(resourceId);
    for (;;) {
      const head = this.queues.peek(resourceId);
      if (!head) break;
      let blocked = false;
      for (const [other, heldMode] of holders) {
        if (other !== head.txnId && !compatible(heldMode, head.mode)) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
      this.queues.dequeue(resourceId);
      holders.set(head.txnId, head.mode);
      this.waits.removeEdgesFrom(head.txnId);
    }
    // Rebuild waits-for edges for the waiters still blocked on this resource.
    for (const waiter of this.queues.list(resourceId)) {
      this.waits.removeEdgesFrom(waiter.txnId);
      for (const [other, heldMode] of holders) {
        if (other !== waiter.txnId && !compatible(heldMode, waiter.mode)) {
          this.waits.addEdge(waiter.txnId, other);
        }
      }
    }
  }

  modeOf(txnId: string, resourceId: string): LockMode | null {
    this.assertTxn(txnId);
    this.assertResource(resourceId);
    return this.held.get(resourceId)?.get(txnId) ?? null;
  }

  holders(resourceId: string): Array<{ txnId: string; mode: LockMode }> {
    this.assertResource(resourceId);
    return [...(this.held.get(resourceId) ?? [])].map(([txnId, mode]) => ({ txnId, mode }));
  }

  waiters(resourceId: string): Array<{ txnId: string; mode: LockMode }> {
    this.assertResource(resourceId);
    return this.queues.list(resourceId).map((r) => ({ txnId: r.txnId, mode: r.mode }));
  }

  activeTxns(): string[] {
    return [...this.txns];
  }

  private holderMap(resourceId: string): Map<string, LockMode> {
    let m = this.held.get(resourceId);
    if (!m) {
      m = new Map();
      this.held.set(resourceId, m);
    }
    return m;
  }

  private assertTxn(txnId: string): void {
    if (!this.txnSet.has(txnId)) {
      throw new InvalidIdError(`unknown transaction: ${txnId}`);
    }
  }

  private assertResource(resourceId: string): void {
    if (!this.tree.has(resourceId)) {
      throw new InvalidIdError(`unknown resource: ${resourceId}`);
    }
  }
}
