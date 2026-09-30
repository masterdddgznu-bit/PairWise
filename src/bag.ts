/** Exact numeric sample bag (base mode). */
export class SampleBag {
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

  sum(): number {
    let s = 0;
    for (const v of this.values) s += v;
    return s;
  }

  clear(): void {
    this.values = [];
  }
}
