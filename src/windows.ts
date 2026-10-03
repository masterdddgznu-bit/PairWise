export type Agg = { count: number; sum: number };

export class WindowTable {
  windowStart(_eventTime: number, _windowSize: number): number {
    return 0;
  }
  add(_key: string, _start: number, _payload: string): void {}
  get(_key: string, _start: number): Agg | undefined {
    return undefined;
  }
  isClosed(_key: string, _start: number): boolean {
    return false;
  }
  markClosed(_key: string, _start: number): void {}
  openEntries(_windowSize: number): Array<{ key: string; start: number; agg: Agg }> {
    return [];
  }
  openCount(): number {
    return 0;
  }
  closedCount(): number {
    return 0;
  }
  exportAll(): unknown {
    return {};
  }
  importAll(_data: unknown): void {}
}
