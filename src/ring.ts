import { RingError } from "./errors.js";
import { fnv32 } from "./hash.js";
import { vnodePositionsForNode } from "./vnode.js";
import type { ConsistentRingState, RingEntry, RingStats } from "./types.js";

/** Consistent hashing ring with virtual nodes. */
export class ConsistentRing {
  private readonly vnodeCount: number;
  private readonly seed: number;
  private readonly nodeIds = new Set<string>();
  private ring: RingEntry[] = [];
  private frozen = false;

  constructor(vnodeCount: number, seed: number) {
    if (!Number.isInteger(vnodeCount) || vnodeCount < 1 || vnodeCount > 256) {
      throw new RingError("vnodeCount must be an integer in [1, 256]");
    }
    this.vnodeCount = vnodeCount;
    this.seed = seed;
  }

  private rebuild(): void {
    const entries: RingEntry[] = [];
    for (const id of this.nodeIds) {
      for (const pos of vnodePositionsForNode(id, this.vnodeCount, this.seed)) {
        entries.push({ pos, id });
      }
    }
    entries.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.ring = entries;
  }

  addNode(id: string): void {
    if (this.frozen) throw new RingError("ring is frozen");
    if (this.nodeIds.has(id)) throw new RingError(`duplicate node: ${id}`);
    this.nodeIds.add(id);
    this.rebuild();
  }

  removeNode(id: string): void {
    if (this.frozen) throw new RingError("ring is frozen");
    if (this.nodeIds.delete(id)) this.rebuild();
  }

  nodes(): string[] {
    return [...this.nodeIds].sort();
  }

  private assignIndex(key: string): number {
    const h = fnv32(this.seed, key);
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid]!.pos >= h) hi = mid;
      else lo = mid + 1;
    }
    return lo === this.ring.length ? 0 : lo;
  }

  assign(key: string): string | null {
    if (this.ring.length === 0) return null;
    return this.ring[this.assignIndex(key)]!.id;
  }

  successors(key: string, k: number): string[] {
    if (k < 1) throw new RingError("k must be >= 1");
    if (this.ring.length === 0) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const start = this.assignIndex(key);
    for (let i = 0; i < this.ring.length && out.length < k; i++) {
      const id = this.ring[(start + i) % this.ring.length]!.id;
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  }

  vnodePositions(id: string): number[] {
    if (!this.nodeIds.has(id)) return [];
    return vnodePositionsForNode(id, this.vnodeCount, this.seed);
  }

  ringSnapshot(): RingEntry[] {
    return this.ring.map((e) => ({ pos: e.pos, id: e.id }));
  }

  exportState(): ConsistentRingState {
    return {
      vnodeCount: this.vnodeCount,
      seed: this.seed,
      nodes: this.nodes(),
    };
  }

  static fromState(state: ConsistentRingState): ConsistentRing {
    const ring = new ConsistentRing(state.vnodeCount, state.seed);
    for (const id of state.nodes) ring.addNode(id);
    return ring;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): RingStats {
    return {
      vnodeCount: this.vnodeCount,
      seed: this.seed,
      frozen: this.frozen,
      nodeCount: this.nodeIds.size,
      ringSize: this.ring.length,
    };
  }
}
