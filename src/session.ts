import type { WindowOut } from "./types.js";

type Session = { start: number; end: number; sum: number };

/** Session windows: merge events within gapMs of the session's last event. */
export class SessionWindows {
  private readonly byKey = new Map<string, Session[]>();

  constructor(private readonly gapMs: number) {}

  ingest(key: string, eventTime: number, value: number): void {
    let arr = this.byKey.get(key);
    if (!arr) {
      arr = [];
      this.byKey.set(key, arr);
    }
    const last = arr[arr.length - 1];
    const lastEvent = last ? last.end - this.gapMs : null;
    if (last && lastEvent !== null && eventTime - lastEvent <= this.gapMs) {
      last.sum += value;
      last.start = Math.min(last.start, eventTime);
      last.end = Math.max(last.end, eventTime + this.gapMs);
      return;
    }
    arr.push({ start: eventTime, end: eventTime + this.gapMs, sum: value });
  }

  flushReady(watermark: number): WindowOut[] {
    const out: WindowOut[] = [];
    for (const [key, arr] of this.byKey) {
      const keep: Session[] = [];
      for (const s of arr) {
        if (s.end <= watermark) {
          out.push({ key, start: s.start, end: s.end, sum: s.sum });
        } else {
          keep.push(s);
        }
      }
      if (keep.length === 0) this.byKey.delete(key);
      else this.byKey.set(key, keep);
    }
    out.sort((a, b) => (a.end !== b.end ? a.end - b.end : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  }

  exportState(): unknown {
    const o: Record<string, Session[]> = {};
    for (const [k, arr] of this.byKey) o[k] = arr.map((s) => ({ ...s }));
    return o;
  }

  importState(raw: unknown): void {
    this.byKey.clear();
    const o = raw as Record<string, Session[]>;
    for (const [k, arr] of Object.entries(o)) {
      this.byKey.set(k, arr.map((s) => ({ ...s })));
    }
  }
}
