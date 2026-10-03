export class WaitForGraph {
  private readonly edges = new Map<string, Set<string>>();

  addEdge(from: string, to: string): void {
    let set = this.edges.get(from);
    if (!set) {
      set = new Set();
      this.edges.set(from, set);
    }
    set.add(to);
  }

  removeEdgesFrom(from: string): void {
    this.edges.delete(from);
  }

  removeEdgesTo(to: string): void {
    for (const set of this.edges.values()) {
      set.delete(to);
    }
  }

  /** True if adding edges from→each of toList would close a cycle. */
  wouldCreateCycle(from: string, toList: string[]): boolean {
    for (const to of toList) {
      if (to === from) return true;
      const seen = new Set<string>([to]);
      const stack = [to];
      while (stack.length > 0) {
        const node = stack.pop() as string;
        if (node === from) return true;
        for (const next of this.edges.get(node) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            stack.push(next);
          }
        }
      }
    }
    return false;
  }

  clear(): void {
    this.edges.clear();
  }
}
