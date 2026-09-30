import { GKError } from "./errors.js";
import type { GKTuple, GKStats } from "./types.js";
import { compressTuples } from "./compress.js";
import { mergeTuplesByValue, sortTuples } from "./tuple.js";

/** Greenwald-Khanna quantile summary (deterministic simplified variant). */
export class GKSummary {
  private readonly epsilon: number;
  private tuples: GKTuple[] = [];
  private n = 0;
  private frozen = false;

  constructor(epsilon: number) {
    if (!Number.isFinite(epsilon) || epsilon <= 0 || epsilon > 0.5) {
      throw new GKError("epsilon must be in (0, 0.5]");
    }
    this.epsilon = epsilon;
  }

  insert(x: number): void {
    this.assertMutable();
    if (!Number.isFinite(x)) {
      throw new GKError("cannot insert non-finite value");
    }
    this.n += 1;
    const tuples = this.tuples;
    if (
      tuples.length === 0 ||
      x < tuples[0]!.value ||
      x > tuples[tuples.length - 1]!.value
    ) {
      const entry: GKTuple = { value: x, g: 1, delta: 0 };
      if (tuples.length === 0 || x > tuples[tuples.length - 1]!.value) {
        tuples.push(entry);
      } else {
        tuples.unshift(entry);
      }
      return;
    }
    const delta = Math.max(0, Math.floor(2 * this.epsilon * this.n) - 1);
    let idx = tuples.length;
    while (idx > 0 && tuples[idx - 1]!.value > x) idx -= 1;
    tuples.splice(idx, 0, { value: x, g: 1, delta });
    this.compress();
  }

  compress(): void {
    compressTuples(this.tuples, this.epsilon, this.n);
  }

  quantile(q: number): number {
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      throw new GKError("quantile must be in [0, 1]");
    }
    if (this.tuples.length === 0) {
      throw new GKError("quantile of empty summary");
    }
    if (q <= 0) return this.tuples[0]!.value;
    if (q >= 1) return this.tuples[this.tuples.length - 1]!.value;
    const target = q * this.n;
    let cum = 0;
    for (const t of this.tuples) {
      cum += t.g;
      if (cum >= target) return t.value;
    }
    return this.tuples[this.tuples.length - 1]!.value;
  }

  merge(other: GKSummary): void {
    this.assertMutable();
    if (other.epsilon !== this.epsilon) {
      throw new GKError("cannot merge summaries with different epsilon");
    }
    this.tuples = mergeTuplesByValue(this.tuples, other.tuples);
    this.n += other.n;
    this.compress();
  }

  exportTuples(): GKTuple[] {
    return this.tuples.map((t) => ({ ...t }));
  }

  static fromTuples(epsilon: number, tuples: GKTuple[]): GKSummary {
    const summary = new GKSummary(epsilon);
    summary.tuples = sortTuples(tuples).map((t) => ({ ...t }));
    summary.n = summary.tuples.reduce((sum, t) => sum + t.g, 0);
    return summary;
  }

  count(): number {
    return this.n;
  }

  tupleCount(): number {
    return this.tuples.length;
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): GKStats {
    return {
      epsilon: this.epsilon,
      count: this.n,
      tuples: this.tuples.length,
      frozen: this.frozen,
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new GKError("summary is frozen");
    }
  }
}
