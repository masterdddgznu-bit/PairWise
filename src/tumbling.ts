import type { WindowOut } from "./types.js";

type Acc = { start: number; end: number; sum: number };

export class TumblingWindows {
  private readonly byKey = new Map<string, Map<number, Acc>>();

  constructor(private readonly sizeMs: number) {}

  ingest(key: string, eventTime: number, value: number): void {
    const start = Math.floor(eventTime / this.sizeMs) * this.sizeMs;
    const end = start + this.sizeMs;
    let m = this.byKey.get(key);
    if (!m) {
      m = new Map();
      this.byKey.set(key, m);
    }
    const cur = m.get(start) ?? { start, end, sum: 0 };
    cur.sum += value;
    m.set(start, cur);
  }

  flushReady(watermark: number): WindowOut[] {
    const out: WindowOut[] = [];
    for (const [key, m] of this.byKey) {
      for (const [start, acc] of [...m.entries()]) {
        if (acc.end <= watermark) {
          out.push({ key, start: acc.start, end: acc.end, sum: acc.sum });
          m.delete(start);
        }
      }
      if (m.size === 0) this.byKey.delete(key);
    }
    out.sort((a, b) => (a.end !== b.end ? a.end - b.end : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  }

  exportState(): unknown {
    const o: Record<string, Acc[]> = {};
    for (const [k, m] of this.byKey) o[k] = [...m.values()];
    return o;
  }

  importState(raw: unknown): void {
    this.byKey.clear();
    const o = raw as Record<string, Acc[]>;
    for (const [k, arr] of Object.entries(o)) {
      const m = new Map<number, Acc>();
      for (const acc of arr) m.set(acc.start, { ...acc });
      this.byKey.set(k, m);
    }
  }
}
