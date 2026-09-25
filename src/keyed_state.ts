import type { WindowAccumulator } from "./types.js";

/** Per-key tumbling window aggregates. */
export class KeyedWindowState {
  private byKey = new Map<string, Map<number, WindowAccumulator>>();

  private bucket(key: string): Map<number, WindowAccumulator> {
    let m = this.byKey.get(key);
    if (!m) {
      m = new Map();
      this.byKey.set(key, m);
    }
    return m;
  }

  get(key: string, windowStart: number): WindowAccumulator | undefined {
    return this.bucket(key).get(windowStart);
  }

  ensure(key: string, windowStart: number, windowEnd: number): WindowAccumulator {
    const b = this.bucket(key);
    let w = b.get(windowStart);
    if (!w) {
      w = { windowStart, windowEnd, sum: 0, closed: false };
      b.set(windowStart, w);
    }
    return w;
  }

  add(key: string, windowStart: number, windowEnd: number, value: number): void {
    const w = this.ensure(key, windowStart, windowEnd);
    w.sum += value;
  }

  isClosed(key: string, windowStart: number): boolean {
    return this.bucket(key).get(windowStart)?.closed ?? false;
  }

  closeWhereEndAtMost(watermark: number): Array<{ key: string; window: WindowAccumulator }> {
    const closed: Array<{ key: string; window: WindowAccumulator }> = [];
    for (const [key, bucket] of this.byKey) {
      for (const w of bucket.values()) {
        if (!w.closed && w.windowEnd <= watermark) {
          w.closed = true;
          closed.push({ key, window: w });
        }
      }
    }
    return closed;
  }

  openWindows(): WindowAccumulator[] {
    const open: WindowAccumulator[] = [];
    for (const bucket of this.byKey.values()) {
      for (const w of bucket.values()) {
        if (!w.closed) open.push(w);
      }
    }
    return open;
  }

  toRecord(): Record<string, Record<string, WindowAccumulator>> {
    const out: Record<string, Record<string, WindowAccumulator>> = {};
    for (const [key, bucket] of this.byKey) {
      out[key] = {};
      for (const [ws, w] of bucket) {
        out[key][String(ws)] = { ...w };
      }
    }
    return out;
  }

  restore(data: Record<string, Record<string, WindowAccumulator>>): void {
    this.byKey.clear();
    for (const [key, bucket] of Object.entries(data)) {
      const m = new Map<number, WindowAccumulator>();
      for (const [ws, w] of Object.entries(bucket)) {
        m.set(Number(ws), { ...w });
      }
      this.byKey.set(key, m);
    }
  }
}
