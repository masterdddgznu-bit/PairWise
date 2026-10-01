/** Exact token bag (base mode). */
export class ExactBag {
  private readonly counts = new Map<string, number>();

  add(token: string, weight = 1): void {
    const next = (this.counts.get(token) ?? 0) + weight;
    if (next <= 0) this.counts.delete(token);
    else this.counts.set(token, next);
  }

  remove(token: string, weight = 1): void {
    const next = Math.max(0, (this.counts.get(token) ?? 0) - weight);
    if (next === 0) this.counts.delete(token);
    else this.counts.set(token, next);
  }

  has(token: string): boolean {
    return (this.counts.get(token) ?? 0) > 0;
  }

  size(): number {
    return this.counts.size;
  }

  clear(): void {
    this.counts.clear();
  }

  tokens(): string[] {
    return [...this.counts.keys()].sort();
  }
}
