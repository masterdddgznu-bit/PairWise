import { SkipError } from "./errors.js";
import { LcgRng } from "./rng.js";
import { SkipNode } from "./node.js";
import type { SkipListState, SkipStats } from "./types.js";

/** Deterministic skip list ordered map. */
export class SkipList {
  private readonly maxLevel: number;
  private readonly seed: number;
  private rng: LcgRng;
  private readonly head: SkipNode;
  private count = 0;
  private frozen = false;

  constructor(maxLevel: number, seed: number, p?: number) {
    if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 16) {
      throw new SkipError(`maxLevel must be an integer in [1, 16], got ${maxLevel}`);
    }
    if (p !== undefined && p !== 0.5) {
      throw new SkipError(`p must be 0.5, got ${p}`);
    }
    this.maxLevel = maxLevel;
    this.seed = seed;
    this.rng = new LcgRng(seed);
    this.head = new SkipNode("", 0, maxLevel);
  }

  private randomLevel(): number {
    let level = 1;
    while (level < this.maxLevel && this.rng.nextFloat() < 0.5) {
      level += 1;
    }
    return level;
  }

  private findUpdatePath(key: string): SkipNode[] {
    const update: SkipNode[] = new Array<SkipNode>(this.maxLevel);
    let current = this.head;
    for (let i = this.maxLevel - 1; i >= 0; i -= 1) {
      while (current.forward[i] !== null && current.forward[i]!.key < key) {
        current = current.forward[i]!;
      }
      update[i] = current;
    }
    return update;
  }

  set(key: string, value: number): void {
    if (this.frozen) throw new SkipError("SkipList is frozen");
    const update = this.findUpdatePath(key);
    const existing = update[0]!.forward[0];
    if (existing !== null && existing.key === key) {
      existing.value = value;
      return;
    }
    const level = this.randomLevel();
    const node = new SkipNode(key, value, level);
    for (let i = 0; i < level; i += 1) {
      node.forward[i] = update[i]!.forward[i];
      update[i]!.forward[i] = node;
    }
    this.count += 1;
  }

  get(key: string): number | undefined {
    let current = this.head;
    for (let i = this.maxLevel - 1; i >= 0; i -= 1) {
      while (current.forward[i] !== null && current.forward[i]!.key < key) {
        current = current.forward[i]!;
      }
    }
    const next = current.forward[0];
    return next !== null && next.key === key ? next.value : undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): boolean {
    if (this.frozen) throw new SkipError("SkipList is frozen");
    const update = this.findUpdatePath(key);
    const target = update[0]!.forward[0];
    if (target === null || target.key !== key) return false;
    for (let i = 0; i < target.level; i += 1) {
      update[i]!.forward[i] = target.forward[i];
    }
    this.count -= 1;
    return true;
  }

  size(): number {
    return this.count;
  }

  range(minKey: string, maxKey: string): { key: string; value: number }[] {
    const result: { key: string; value: number }[] = [];
    let current = this.head;
    for (let i = this.maxLevel - 1; i >= 0; i -= 1) {
      while (current.forward[i] !== null && current.forward[i]!.key < minKey) {
        current = current.forward[i]!;
      }
    }
    let node = current.forward[0];
    while (node !== null && node.key <= maxKey) {
      result.push({ key: node.key, value: node.value });
      node = node.forward[0];
    }
    return result;
  }

  keys(): string[] {
    return this.toArray().map((entry) => entry.key);
  }

  toArray(): { key: string; value: number }[] {
    const result: { key: string; value: number }[] = [];
    let node = this.head.forward[0];
    while (node !== null) {
      result.push({ key: node.key, value: node.value });
      node = node.forward[0];
    }
    return result;
  }

  exportState(): SkipListState {
    const entries: { key: string; value: number; level: number }[] = [];
    let node = this.head.forward[0];
    while (node !== null) {
      entries.push({ key: node.key, value: node.value, level: node.level });
      node = node.forward[0];
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
    const update: SkipNode[] = new Array<SkipNode>(state.maxLevel).fill(list.head);
    for (const entry of state.entries) {
      const node = new SkipNode(entry.key, entry.value, entry.level);
      for (let i = 0; i < entry.level; i += 1) {
        node.forward[i] = update[i]!.forward[i];
        update[i]!.forward[i] = node;
      }
      for (let i = 0; i < entry.level; i += 1) {
        update[i] = node;
      }
      list.count += 1;
    }
    return list;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): SkipStats {
    let height = 0;
    let node = this.head.forward[0];
    while (node !== null) {
      if (node.level > height) height = node.level;
      node = node.forward[0];
    }
    return {
      maxLevel: this.maxLevel,
      seed: this.seed,
      frozen: this.frozen,
      size: this.count,
      height,
    };
  }
}
