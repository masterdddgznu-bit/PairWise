import { InvalidConfigError } from "./errors.js";
import type { NodeSpec } from "./types.js";
import type { BucketStore } from "./bucket.js";

export class QuotaTree {
  readonly roots: string[] = [];
  private readonly parent = new Map<string, string | null>();
  private readonly children = new Map<string, string[]>();

  constructor(nodes: NodeSpec[], buckets: BucketStore) {
    if (nodes.length === 0) throw new InvalidConfigError("empty");
    const ids = new Set<string>();
    for (const n of nodes) {
      if (!n.id || ids.has(n.id)) throw new InvalidConfigError("dup");
      if (!Number.isFinite(n.soft) || !Number.isFinite(n.hard)) {
        throw new InvalidConfigError("limits");
      }
      if (n.soft < 0 || n.hard < n.soft) throw new InvalidConfigError("soft/hard");
      ids.add(n.id);
    }
    for (const n of nodes) {
      const p = n.parentId ?? null;
      if (p !== null && !ids.has(p)) throw new InvalidConfigError("parent");
      this.parent.set(n.id, p);
      buckets.init(n.id, n.soft, n.hard);
      if (!this.children.has(n.id)) this.children.set(n.id, []);
    }
    for (const n of nodes) {
      const p = n.parentId ?? null;
      if (p === null) this.roots.push(n.id);
      else {
        this.children.get(p)!.push(n.id);
      }
    }
    for (const id of ids) {
      const seen = new Set<string>();
      let cur: string | null = id;
      while (cur) {
        if (seen.has(cur)) throw new InvalidConfigError("cycle");
        seen.add(cur);
        cur = this.parent.get(cur) ?? null;
      }
    }
  }

  has(id: string): boolean {
    return this.parent.has(id);
  }

  /** Ancestors from node up to root, inclusive. */
  pathToRoot(nodeId: string): string[] {
    const out: string[] = [];
    let cur: string | null = nodeId;
    while (cur) {
      out.push(cur);
      cur = this.parent.get(cur) ?? null;
    }
    return out;
  }

  canFit(buckets: BucketStore, nodeId: string, amount: number): boolean {
    return buckets.headroom(nodeId) >= amount;
  }

  applyReserved(buckets: BucketStore, nodeId: string, amount: number): void {
    for (const id of this.pathToRoot(nodeId)) {
      buckets.addReserved(id, amount);
    }
  }

  releaseReserved(buckets: BucketStore, nodeId: string, amount: number): void {
    for (const id of this.pathToRoot(nodeId)) {
      buckets.subReserved(id, amount);
    }
  }

  applyCommit(buckets: BucketStore, nodeId: string, used: number): void {
    for (const id of this.pathToRoot(nodeId)) {
      buckets.subReserved(id, used);
      buckets.addCommitted(id, used);
    }
  }
}
