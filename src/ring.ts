import { RingError } from "./errors.js";
import { fnv32 } from "./hash.js";
import type { ConsistentRingState, RingEntry, RingStats } from "./types.js";
import { vnodePositionsForNode } from "./vnode.js";

/** Consistent hashing ring with virtual nodes. */
export class ConsistentRing {
  private readonly vnodeCount: number;
  private readonly seed: number;
  private readonly ids = new Set<string>();
  private ring: RingEntry[] = [];
  private frozen = false;

  constructor(vnodeCount: number, seed: number) {
    if (!Number.isInteger(vnodeCount) || vnodeCount < 1 || vnodeCount > 256) {
      throw new RingError("vnodeCount must be an integer in [1, 256]");
    }
    this.vnodeCount = vnodeCount;
    this.seed = seed;
  }

  addNode(id: string): void {
    this.assertMutable();
    if (this.ids.has(id)) {
      throw new RingError(`node already exists: ${id}`);
    }
    this.ids.add(id);
    this.rebuild();
  }

  removeNode(id: string): void {
    this.assertMutable();
    this.ids.delete(id);
    this.rebuild();
  }

  nodes(): string[] {
    return [...this.ids].sort();
  }

  assign(key: string): string | null {
    const idx = this.findIndex(key);
    if (idx === -1) return null;
    return this.ring[idx]!.id;
  }

  successors(key: string, k: number): string[] {
    if (!Number.isInteger(k) || k < 1) {
      throw new RingError("k must be an integer >= 1");
    }
    const start = this.findIndex(key);
    if (start === -1) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (let step = 0; step < this.ring.length && out.length < k; step++) {
      const entry = this.ring[(start + step) % this.ring.length]!;
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        out.push(entry.id);
      }
    }
    return out;
  }

  vnodePositions(id: string): number[] {
    if (!this.ids.has(id)) return [];
    return vnodePositionsForNode(id, this.vnodeCount, this.seed);
  }

  ringSnapshot(): RingEntry[] {
    return this.ring.map((entry) => ({ ...entry }));
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
    for (const id of state.nodes) {
      ring.addNode(id);
    }
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
      nodeCount: this.ids.size,
      ringSize: this.ring.length,
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new RingError("ring is frozen");
    }
  }

  private rebuild(): void {
    const entries: RingEntry[] = [];
    for (const id of this.ids) {
      for (const pos of vnodePositionsForNode(id, this.vnodeCount, this.seed)) {
        entries.push({ pos, id });
      }
    }
    entries.sort((a, b) => (a.pos - b.pos) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.ring = entries;
  }

  private findIndex(key: string): number {
    if (this.ring.length === 0) return -1;
    const h = fnv32(this.seed, key);
    let lo = 0;
    let hi = this.ring.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ring[mid]!.pos < h) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo < this.ring.length ? lo : 0;
  }
}
