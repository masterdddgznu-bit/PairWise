import { LossyError } from "./errors.js";
import { pruneEntries } from "./prune.js";
import type { LossyEntry, LossyStats } from "./types.js";

/** Lossy Counting frequent-item sketch. */
export class LossyCounter {
  private readonly epsilon: number;
  private readonly w: number;
  private N = 0;
  private b = 0;
  private readonly entries = new Map<string, { f: number; delta: number }>();
  private frozen = false;

  constructor(epsilon: number) {
    if (
      typeof epsilon !== "number" ||
      !Number.isFinite(epsilon) ||
      epsilon <= 0 ||
      epsilon > 0.5
    ) {
      throw new LossyError("epsilon must be in (0, 0.5]");
    }
    this.epsilon = epsilon;
    this.w = Math.floor(1 / epsilon);
  }

  add(key: string): void {
    this.assertMutable();
    this.N += 1;
    this.b = Math.ceil(this.N / this.w);
    const existing = this.entries.get(key);
    if (existing) {
      existing.f += 1;
    } else {
      this.entries.set(key, { f: 1, delta: this.b - 1 });
    }
    if (this.N % this.w === 0) {
      pruneEntries(this.entries, this.b);
    }
  }

  estimate(key: string): number {
    return this.entries.get(key)?.f ?? 0;
  }

  upperBound(key: string): number {
    const entry = this.entries.get(key);
    return entry ? entry.f + entry.delta : 0;
  }

  mightFrequent(key: string, support: number): boolean {
    if (
      typeof support !== "number" ||
      !Number.isFinite(support) ||
      support <= 0 ||
      support > 1
    ) {
      throw new LossyError("support must be in (0, 1]");
    }
    if (this.N === 0) return false;
    return this.estimate(key) / this.N >= support - this.epsilon;
  }

  merge(other: LossyCounter): void {
    this.assertMutable();
    if (!(other instanceof LossyCounter)) {
      throw new LossyError("merge target must be a LossyCounter");
    }
    if (other.epsilon !== this.epsilon) {
      throw new LossyError("cannot merge counters with different epsilon");
    }
    for (const [key, entry] of other.entries) {
      const existing = this.entries.get(key);
      if (existing) {
        existing.f += entry.f;
        existing.delta = Math.max(existing.delta, entry.delta);
      } else {
        this.entries.set(key, { f: entry.f, delta: entry.delta });
      }
    }
    this.N += other.N;
    this.b = Math.ceil(this.N / this.w);
    pruneEntries(this.entries, this.b);
  }

  exportEntries(): LossyEntry[] {
    return [...this.entries.entries()]
      .map(([key, entry]) => ({ key, f: entry.f, delta: entry.delta }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  static fromEntries(
    epsilon: number,
    N: number,
    entries: LossyEntry[],
  ): LossyCounter {
    if (!Number.isInteger(N) || N < 0) {
      throw new LossyError("N must be a non-negative integer");
    }
    const counter = new LossyCounter(epsilon);
    counter.N = N;
    counter.b = Math.ceil(N / counter.w);
    for (const entry of entries) {
      counter.entries.set(entry.key, { f: entry.f, delta: entry.delta });
    }
    return counter;
  }

  countStream(): number {
    return this.N;
  }

  bucket(): number {
    return this.b;
  }

  size(): number {
    return this.entries.size;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): LossyStats {
    return {
      epsilon: this.epsilon,
      w: this.w,
      N: this.N,
      bucket: this.b,
      size: this.entries.size,
      frozen: this.frozen,
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new LossyError("counter is frozen");
    }
  }
}
