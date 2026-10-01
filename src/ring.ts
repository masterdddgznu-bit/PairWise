import { RendezvousError } from "./errors.js";
import { rendezvousScore } from "./score.js";
import type { NodeRecord, RendezvousStats } from "./types.js";

/** Rendezvous / HRW hashing. */
export class RendezvousHash {
  private readonly seed: number;
  private readonly nodes = new Map<string, number>();
  private frozen = false;

  constructor(seed: number) {
    this.seed = seed;
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new RendezvousError("RendezvousHash is frozen");
    }
  }

  addNode(id: string, weight = 1): void {
    this.assertMutable();
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RendezvousError(`invalid weight for node ${id}: ${weight}`);
    }
    this.nodes.set(id, weight);
  }

  removeNode(id: string): void {
    this.assertMutable();
    this.nodes.delete(id);
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  nodeWeight(id: string): number {
    const weight = this.nodes.get(id);
    if (weight === undefined) {
      throw new RendezvousError(`unknown node: ${id}`);
    }
    return weight;
  }

  private ranked(key: string): { id: string; score: bigint }[] {
    return [...this.nodes.entries()]
      .map(([id, weight]) => ({
        id,
        score: rendezvousScore(this.seed, key, id, weight),
      }))
      .sort((a, b) =>
        a.score > b.score ? -1 : a.score < b.score ? 1 : a.id.localeCompare(b.id),
      );
  }

  pick(key: string): string | null {
    const ranked = this.ranked(key);
    return ranked.length === 0 ? null : ranked[0]!.id;
  }

  topK(key: string, k: number): string[] {
    if (k < 1) {
      throw new RendezvousError(`k must be >= 1, got ${k}`);
    }
    return this.ranked(key)
      .slice(0, k)
      .map((entry) => entry.id);
  }

  exportNodes(): NodeRecord[] {
    return [...this.nodes.entries()]
      .map(([id, weight]) => ({ id, weight }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  static fromNodes(seed: number, nodes: NodeRecord[]): RendezvousHash {
    const ring = new RendezvousHash(seed);
    for (const node of nodes) {
      ring.addNode(node.id, node.weight);
    }
    return ring;
  }

  needsRebalance(threshold: number): boolean {
    if (this.nodes.size < 2) {
      return false;
    }
    let min = Infinity;
    let max = 0;
    for (const weight of this.nodes.values()) {
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
    for (const weight of this.nodes.values()) {
      totalWeight += weight;
    }
    return {
      seed: this.seed,
      frozen: this.frozen,
      size: this.nodes.size,
      totalWeight,
    };
  }
}
