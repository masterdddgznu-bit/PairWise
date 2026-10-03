export type Agg = { count: number; sum: number };

type OpenEntry = { key: string; start: number; agg: Agg };

function idOf(key: string, start: number): string {
  return `${start}${key}`;
}

export class WindowTable {
  private open = new Map<string, OpenEntry>();
  private closed = new Set<string>();

  windowStart(eventTime: number, windowSize: number): number {
    return Math.floor(eventTime / windowSize) * windowSize;
  }
  add(key: string, start: number, payload: string): void {
    const id = idOf(key, start);
    let entry = this.open.get(id);
    if (!entry) {
      entry = { key, start, agg: { count: 0, sum: 0 } };
      this.open.set(id, entry);
    }
    const num = Number(payload);
    entry.agg.count += 1;
    entry.agg.sum += Number.isFinite(num) ? num : 0;
  }
  get(key: string, start: number): Agg | undefined {
    const entry = this.open.get(idOf(key, start));
    return entry ? { ...entry.agg } : undefined;
  }
  isClosed(key: string, start: number): boolean {
    return this.closed.has(idOf(key, start));
  }
  markClosed(key: string, start: number): void {
    const id = idOf(key, start);
    this.open.delete(id);
    this.closed.add(id);
  }
  openEntries(_windowSize: number): Array<{ key: string; start: number; agg: Agg }> {
    return [...this.open.values()].map((e) => ({
      key: e.key,
      start: e.start,
      agg: { ...e.agg },
    }));
  }
  openCount(): number {
    return this.open.size;
  }
  closedCount(): number {
    return this.closed.size;
  }
  exportAll(): unknown {
    return {
      open: [...this.open.values()].map((e) => ({
        key: e.key,
        start: e.start,
        count: e.agg.count,
        sum: e.agg.sum,
      })),
      closed: [...this.closed].map((id) => {
        const sep = id.indexOf("");
        return [id.slice(sep + 1), Number(id.slice(0, sep))] as [string, number];
      }),
    };
  }
  importAll(data: unknown): void {
    const d = data as {
      open: Array<{ key: string; start: number; count: number; sum: number }>;
      closed: Array<[string, number]>;
    };
    this.open.clear();
    this.closed.clear();
    for (const e of d.open) {
      this.open.set(idOf(e.key, e.start), {
        key: e.key,
        start: e.start,
        agg: { count: e.count, sum: e.sum },
      });
    }
    for (const [key, start] of d.closed) {
      this.closed.add(idOf(key, start));
    }
  }
}
