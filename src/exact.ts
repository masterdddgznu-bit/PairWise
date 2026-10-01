/** Exact lex-min router (base mode). */
export class ExactRouter {
  private readonly nodeIds = new Set<string>();

  addNode(id: string, _weight = 1): void {
    this.nodeIds.add(id);
  }

  removeNode(id: string): void {
    this.nodeIds.delete(id);
  }

  nodes(): string[] {
    return [...this.nodeIds].sort();
  }

  size(): number {
    return this.nodeIds.size;
  }

  routeExact(_key: string): string | null {
    const sorted = this.nodes();
    return sorted.length === 0 ? null : sorted[0]!;
  }

  clear(): void {
    this.nodeIds.clear();
  }
}
