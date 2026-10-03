import type { WindowOut } from "./types.js";

type SessionAcc = { start: number; last: number; sum: number };

export class SessionWindows {
  private readonly byKey = new Map<string, SessionAcc[]>();

  constructor(private readonly gapMs: number) {}

  ingest(key: string, eventTime: number, value: number): void {
    let list = this.byKey.get(key);
    if (!list) {
      list = [];
      this.byKey.set(key, list);
    }
    const hit = list.find(
      (s) => eventTime >= s.start - this.gapMs && eventTime <= s.last + this.gapMs,
    );
    if (hit) {
      hit.start = Math.min(hit.start, eventTime);
      hit.last = Math.max(hit.last, eventTime);
      hit.sum += value;
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i];
        if (s === hit) continue;
        if (s.start <= hit.last + this.gapMs && s.last >= hit.start - this.gapMs) {
          hit.start = Math.min(hit.start, s.start);
          hit.last = Math.max(hit.last, s.last);
          hit.sum += s.sum;
          list.splice(i, 1);
        }
      }
    } else {
      list.push({ start: eventTime, last: eventTime, sum: value });
    }
    list.sort((a, b) => a.start - b.start);
  }

  flushReady(watermark: number): WindowOut[] {
    const out: WindowOut[] = [];
    for (const [key, list] of this.byKey) {
      const keep: SessionAcc[] = [];
      for (const s of list) {
        const end = s.last + this.gapMs;
        if (end <= watermark) {
          out.push({ key, start: s.start, end, sum: s.sum });
        } else {
          keep.push(s);
        }
      }
      if (keep.length === 0) this.byKey.delete(key);
      else this.byKey.set(key, keep);
    }
    out.sort((a, b) =>
      a.end !== b.end ? a.end - b.end : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    return out;
  }

  exportState(): unknown {
    const o: Record<string, SessionAcc[]> = {};
    for (const [k, list] of this.byKey) o[k] = list.map((s) => ({ ...s }));
    return o;
  }

  importState(raw: unknown): void {
    this.byKey.clear();
    const o = raw as Record<string, SessionAcc[]>;
    for (const [k, arr] of Object.entries(o)) {
      this.byKey.set(k, arr.map((s) => ({ ...s })));
    }
  }
}
