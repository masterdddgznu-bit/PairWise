import type { SessionAgg, StreamEvent } from "./types.js";
import { LateWinError } from "./errors.js";

type Session = {
  key: string;
  start: number;
  end: number;
  sum: number;
  count: number;
  closed: boolean;
};

export class SessionWindows {
  private gap: number | null = null;
  private readonly sessions = new Map<string, Session[]>();

  enable(gap: number): void {
    if (!(gap >= 0)) throw new LateWinError("session gap must be >= 0");
    this.gap = gap;
  }

  enabled(): boolean {
    return this.gap !== null;
  }

  onEvent(ev: StreamEvent): "ok" | "late" {
    const gap = this.gap as number;
    const list = this.sessions.get(ev.key) ?? [];

    const open = list
      .filter((s) => !s.closed)
      .sort((a, b) => b.end - a.end);
    const target = open.find(
      (s) => ev.eventTime <= s.end + gap,
    );

    if (target) {
      if (ev.eventTime < target.start) target.start = ev.eventTime;
      if (ev.eventTime > target.end) target.end = ev.eventTime;
      target.sum += ev.value;
      target.count += 1;
      this.sessions.set(ev.key, list);
      return "ok";
    }

    const nearClosed = list.some(
      (s) =>
        s.closed &&
        ev.eventTime <= s.end + gap &&
        ev.eventTime >= s.start - gap,
    );
    if (nearClosed) return "late";

    list.push({
      key: ev.key,
      start: ev.eventTime,
      end: ev.eventTime,
      sum: ev.value,
      count: 1,
      closed: false,
    });
    this.sessions.set(ev.key, list);
    return "ok";
  }

  onWatermark(watermark: number, allowed: number): void {
    for (const list of this.sessions.values()) {
      for (const s of list) {
        if (!s.closed && watermark >= s.end + allowed) s.closed = true;
      }
    }
  }

  results(): SessionAgg[] {
    const closed: SessionAgg[] = [];
    for (const list of this.sessions.values()) {
      for (const s of list) {
        if (s.closed) {
          closed.push({
            key: s.key,
            start: s.start,
            end: s.end,
            sum: s.sum,
            count: s.count,
          });
        }
      }
    }
    closed.sort((a, b) => {
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return a.start - b.start;
    });
    return closed;
  }
}
