export class AckTable {
  private table = new Map<number, Set<string>>();

  ack(replica: string, index: number): void {
    let set = this.table.get(index);
    if (!set) {
      set = new Set();
      this.table.set(index, set);
    }
    set.add(replica);
  }

  count(index: number): number {
    return this.table.get(index)?.size ?? 0;
  }

  byIndex(index: number): string[] {
    return [...(this.table.get(index) ?? [])].sort();
  }

  clearIndex(index: number): void {
    this.table.delete(index);
  }

  clearFrom(index: number): void {
    for (const i of [...this.table.keys()]) {
      if (i >= index) this.table.delete(i);
    }
  }

  snapshot(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [i, set] of this.table) out[String(i)] = [...set].sort();
    return out;
  }

  restore(snapshot: Record<string, string[]>): void {
    this.table = new Map(
      Object.entries(snapshot).map(([k, v]) => [Number(k), new Set(v)]),
    );
  }
}
