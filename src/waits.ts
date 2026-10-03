export class WaitForGraph {
  private readonly edges = new Map<string, Set<string>>();

  addEdge(from: string, to: string): void {
    const set = this.edges.get(from);
    if (set) set.add(to);
    else this.edges.set(from, new Set([to]));
  }

  removeEdgesFrom(from: string): void {
    this.edges.delete(from);
  }

  removeEdgesTo(to: string): void {
    for (const set of this.edges.values()) set.delete(to);
  }

  /** True if adding edges from→each of toList would close a cycle. */
  wouldCreateCycle(from: string, toList: string[]): boolean {
    for (const to of toList) {
      if (to === from) return true;
      const seen = new Set<string>();
      const stack = [to];
      while (stack.length > 0) {
        const node = stack.pop() as string;
        if (node === from) return true;
        if (seen.has(node)) continue;
        seen.add(node);
        for (const next of this.edges.get(node) ?? []) stack.push(next);
      }
    }
    return false;
  }

  clear(): void {
    this.edges.clear();
  }
}
