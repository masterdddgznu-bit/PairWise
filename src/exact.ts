/** Exact numeric sample set (base mode). */
export class ExactSamples {
  private values: number[] = [];

  add(x: number): void {
    this.values.push(x);
  }

  size(): number {
    return this.values.length;
  }

  sorted(): number[] {
    return [...this.values].sort((a, b) => a - b);
  }

  quantileExact(q: number): number {
    if (q < 0 || q > 1 || !Number.isFinite(q)) {
      throw new Error("invalid quantile");
    }
    if (this.values.length === 0) {
      throw new Error("empty samples");
    }
    const s = this.sorted();
    if (q <= 0) return s[0]!;
    if (q >= 1) return s[s.length - 1]!;
    const pos = q * (s.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return s[lo]!;
    const frac = pos - lo;
    return s[lo]! + frac * (s[hi]! - s[lo]!);
  }

  clear(): void {
    this.values = [];
  }
}
