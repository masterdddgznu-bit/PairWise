export class EventRegistry {
  private readonly entries = new Map<string, number>();

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): number | undefined {
    return this.entries.get(id);
  }

  add(id: string, ts: number): void {
    this.entries.set(id, ts);
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  size(): number {
    return this.entries.size;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  purgeWhere(pred: (ts: number) => boolean): string[] {
    const purged: string[] = [];
    for (const [id, ts] of this.entries) {
      if (pred(ts)) {
        this.entries.delete(id);
        purged.push(id);
      }
    }
    return purged;
  }

  countWhere(pred: (id: string, ts: number) => boolean): number {
    let n = 0;
    for (const [id, ts] of this.entries) {
      if (pred(id, ts)) n += 1;
    }
    return n;
  }

  idsWhere(pred: (id: string, ts: number) => boolean): string[] {
    const out: string[] = [];
    for (const [id, ts] of this.entries) {
      if (pred(id, ts)) out.push(id);
    }
    return out;
  }
}
