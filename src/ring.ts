import { RendezvousError } from "./errors.js";
import { rendezvousScore } from "./score.js";
import type { NodeRecord, RendezvousStats } from "./types.js";

/** Rendezvous / HRW hashing. */
export class RendezvousHash {
  private readonly seed: number;
  private readonly weights = new Map<string, number>();
  private frozen = false;

  constructor(seed: number) {
    this.seed = seed;
  }

  addNode(id: string, weight = 1): void {
    this.assertMutable();
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RendezvousError(`invalid weight for node ${id}: ${weight}`);
    }
    this.weights.set(id, weight);
  }

  removeNode(id: string): void {
    this.assertMutable();
    this.weights.delete(id);
  }

  hasNode(id: string): boolean {
    return this.weights.has(id);
  }

  nodeWeight(id: string): number {
    const weight = this.weights.get(id);
    if (weight === undefined) {
      throw new RendezvousError(`unknown node: ${id}`);
    }
    return weight;
  }

  pick(key: string): string | null {
    const ranked = this.rank(key);
    return ranked.length === 0 ? null : ranked[0]!;
  }

  topK(key: string, k: number): string[] {
    if (k < 1) {
      throw new RendezvousError(`k must be >= 1, got ${k}`);
    }
    return this.rank(key).slice(0, k);
  }

  exportNodes(): NodeRecord[] {
    return [...this.weights.entries()]
      .map(([id, weight]) => ({ id, weight }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  static fromNodes(seed: number, nodes: NodeRecord[]): RendezvousHash {
    const ring = new RendezvousHash(seed);
    for (const node of nodes) {
      ring.addNode(node.id, node.weight);
    }
    return ring;
  }

  needsRebalance(threshold: number): boolean {
    if (this.weights.size < 2) {
      return false;
    }
    let min = Infinity;
    let max = -Infinity;
    for (const weight of this.weights.values()) {
      if (weight < min) min = weight;
      if (weight > max) max = weight;
    }
    return max / min > threshold;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): RendezvousStats {
    let totalWeight = 0;
    for (const weight of this.weights.values()) {
      totalWeight += weight;
    }
    return {
      seed: this.seed,
      frozen: this.frozen,
      size: this.weights.size,
      totalWeight,
    };
  }

  private rank(key: string): string[] {
    return [...this.weights.entries()]
      .map(([id, weight]) => ({
        id,
        score: rendezvousScore(this.seed, key, id, weight),
      }))
      .sort((a, b) => {
        if (a.score > b.score) return -1;
        if (a.score < b.score) return 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .map((entry) => entry.id);
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new RendezvousError("RendezvousHash is frozen");
    }
  }
}
