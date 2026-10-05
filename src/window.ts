export interface WindowEntry {
  id: string;
  ts: number;
}

export class WindowRegistry {
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

  inWindow(now: number, windowMs: number): WindowEntry[] {
    const result: WindowEntry[] = [];
    for (const [id, ts] of this.entries) {
      if (now - ts < windowMs) {
        result.push({ id, ts });
      }
    }
    return result;
  }

  purgeStale(now: number, windowMs: number): string[] {
    const purged: string[] = [];
    for (const [id, ts] of this.entries) {
      if (now - ts >= windowMs) {
        purged.push(id);
      }
    }
    for (const id of purged) {
      this.entries.delete(id);
    }
    return purged;
  }
}
