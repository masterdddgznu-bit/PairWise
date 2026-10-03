export class AckTable {
  private readonly table = new Map<number, Set<string>>();

  ack(replica: string, index: number): void {
    let set = this.table.get(index);
    if (!set) {
      set = new Set<string>();
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
    for (const i of this.table.keys()) {
      if (i >= index) this.table.delete(i);
    }
  }

  snapshot(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [index, set] of this.table) {
      out[String(index)] = [...set].sort();
    }
    return out;
  }

  restore(snapshot: Record<string, string[]>): void {
    this.table.clear();
    for (const [key, replicas] of Object.entries(snapshot)) {
      this.table.set(Number(key), new Set(replicas));
    }
  }
}
