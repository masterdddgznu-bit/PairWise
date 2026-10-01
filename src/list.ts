import { SkipError } from "./errors.js";
import { LcgRng } from "./rng.js";
import { SkipNode } from "./node.js";
import type { SkipListState, SkipStats } from "./types.js";

/** Deterministic skip list ordered map. */
export class SkipList {
  private readonly maxLevel: number;
  private readonly seed: number;
  private readonly head: SkipNode;
  private rng: LcgRng;
  private count = 0;
  private height = 0;
  private frozen = false;

  constructor(maxLevel: number, seed: number, p?: number) {
    if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 16) {
      throw new SkipError("maxLevel must be an integer in [1, 16]");
    }
    if (p !== undefined && p !== 0.5) {
      throw new SkipError("p must be 0.5");
    }
    this.maxLevel = maxLevel;
    this.seed = seed >>> 0;
    this.head = new SkipNode("", 0, maxLevel);
    this.rng = new LcgRng(seed);
  }

  private assertMutable(): void {
    if (this.frozen) throw new SkipError("SkipList is frozen");
  }

  private randomLevel(): number {
    let level = 1;
    while (level < this.maxLevel && this.rng.nextFloat() < 0.5) level++;
    return level;
  }

  private findUpdatePath(key: string): SkipNode[] {
    const update: SkipNode[] = new Array<SkipNode>(this.maxLevel);
    let current = this.head;
    for (let level = this.maxLevel - 1; level >= 0; level--) {
      let next = current.forward[level];
      while (next !== null && next.key < key) {
        current = next;
        next = current.forward[level];
      }
      update[level] = current;
    }
    return update;
  }

  set(key: string, value: number): void {
    this.assertMutable();
    const update = this.findUpdatePath(key);
    const existing = update[0]!.forward[0];
    if (existing !== null && existing.key === key) {
      existing.value = value;
      return;
    }
    const level = this.randomLevel();
    const node = new SkipNode(key, value, level);
    for (let i = 0; i < level; i++) {
      node.forward[i] = update[i]!.forward[i];
      update[i]!.forward[i] = node;
    }
    this.count++;
    if (level > this.height) this.height = level;
  }

  get(key: string): number | undefined {
    const update = this.findUpdatePath(key);
    const node = update[0]!.forward[0];
    return node !== null && node.key === key ? node.value : undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    this.assertMutable();
    const update = this.findUpdatePath(key);
    const node = update[0]!.forward[0];
    if (node === null || node.key !== key) return false;
    for (let i = 0; i < node.level; i++) {
      update[i]!.forward[i] = node.forward[i];
    }
    this.count--;
    this.height = this.computeHeight();
    return true;
  }

  private computeHeight(): number {
    let height = 0;
    for (let node = this.head.forward[0]; node !== null; node = node.forward[0]) {
      if (node.level > height) height = node.level;
    }
    return height;
  }

  size(): number {
    return this.count;
  }

  range(minKey: string, maxKey: string): { key: string; value: number }[] {
    const result: { key: string; value: number }[] = [];
    const update = this.findUpdatePath(minKey);
    for (
      let node = update[0]!.forward[0];
      node !== null && node.key <= maxKey;
      node = node.forward[0]
    ) {
      result.push({ key: node.key, value: node.value });
    }
    return result;
  }

  keys(): string[] {
    return this.toArray().map((entry) => entry.key);
  }

  toArray(): { key: string; value: number }[] {
    const result: { key: string; value: number }[] = [];
    for (let node = this.head.forward[0]; node !== null; node = node.forward[0]) {
      result.push({ key: node.key, value: node.value });
    }
    return result;
  }

  exportState(): SkipListState {
    const entries: { key: string; value: number; level: number }[] = [];
    for (let node = this.head.forward[0]; node !== null; node = node.forward[0]) {
      entries.push({ key: node.key, value: node.value, level: node.level });
    }
    return {
      maxLevel: this.maxLevel,
      seed: this.seed,
      rngState: this.rng.getState(),
      entries,
    };
  }

  static fromState(state: SkipListState): SkipList {
    const list = new SkipList(state.maxLevel, state.seed);
    list.rng = LcgRng.fromState(state.rngState);
    let tail: SkipNode[] = new Array<SkipNode>(list.maxLevel).fill(list.head);
    for (const entry of state.entries) {
      const node = new SkipNode(entry.key, entry.value, entry.level);
      for (let i = 0; i < entry.level; i++) {
        tail[i]!.forward[i] = node;
        tail[i] = node;
      }
      list.count++;
      if (entry.level > list.height) list.height = entry.level;
    }
    return list;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SkipStats {
    return {
      maxLevel: this.maxLevel,
      seed: this.seed,
      frozen: this.frozen,
      size: this.count,
      height: this.height,
    };
  }
}
