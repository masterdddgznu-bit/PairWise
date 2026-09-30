/** Exact string set for Jaccard ground truth (base mode). */
export class ExactSet {
  private readonly keys = new Set<string>();

  add(s: string): void {
    this.keys.add(s);
  }

  has(s: string): boolean {
    return this.keys.has(s);
  }

  size(): number {
    return this.keys.size;
  }

  values(): string[] {
    return [...this.keys].sort();
  }

  jaccardExact(other: ExactSet): number {
    if (this.keys.size === 0 && other.keys.size === 0) return 1;
    if (this.keys.size === 0 || other.keys.size === 0) return 0;
    let inter = 0;
    for (const k of this.keys) {
      if (other.keys.has(k)) inter++;
    }
    const union = this.keys.size + other.keys.size - inter;
    return inter / union;
  }

  clear(): void {
    this.keys.clear();
  }
}
