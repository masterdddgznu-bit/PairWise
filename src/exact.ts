/** Exact sorted string→number map (base mode). */
export class ExactMap {
  private readonly data = new Map<string, number>();

  set(key: string, value: number): void {
    this.data.set(key, value);
  }

  get(key: string): number | undefined {
    return this.data.get(key);
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  size(): number {
    return this.data.size;
  }

  keys(): string[] {
    return [...this.data.keys()].sort();
  }

  clear(): void {
    this.data.clear();
  }
}
