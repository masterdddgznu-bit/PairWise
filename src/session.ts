import type { SessionAgg, StreamEvent } from "./types.js";
import { LateWinError } from "./errors.js";

type Session = {
  key: string;
  start: number;
  end: number;
  sum: number;
  count: number;
};

export class SessionWindows {
  private gap = -1;
  private readonly open = new Map<string, Session[]>();
  private readonly closed: Session[] = [];

  enable(gap: number): void {
    if (!(gap >= 0)) throw new LateWinError("session gap must be >= 0");
    this.gap = gap;
  }

  enabled(): boolean {
    return this.gap >= 0;
  }

  private latestOpen(key: string): Session | null {
    const sessions = this.open.get(key);
    if (!sessions || sessions.length === 0) return null;
    let latest = sessions[0];
    for (const session of sessions) {
      if (session.end > latest.end) latest = session;
    }
    return latest;
  }

  private merge(session: Session, ev: StreamEvent): void {
    if (ev.eventTime < session.start) session.start = ev.eventTime;
    if (ev.eventTime > session.end) session.end = ev.eventTime;
    session.sum += ev.value;
    session.count += 1;
  }

  onEvent(ev: StreamEvent, useClosedFallback: boolean): "ok" | "late" {
    const keySessions = this.open.get(ev.key);
    if (keySessions && keySessions.length > 0) {
      const target = this.latestOpen(ev.key)!;
      if (ev.eventTime <= target.end + this.gap) {
        this.merge(target, ev);
        return "ok";
      }
    }

    if (useClosedFallback && this.fallsInClosedNeighborhood(ev)) {
      return "late";
    }

    const session: Session = {
      key: ev.key,
      start: ev.eventTime,
      end: ev.eventTime,
      sum: ev.value,
      count: 1,
    };
    if (keySessions) {
      keySessions.push(session);
    } else {
      this.open.set(ev.key, [session]);
    }
    return "ok";
  }

  private fallsInClosedNeighborhood(ev: StreamEvent): boolean {
    return this.closed.some(
      (session) =>
        session.key === ev.key &&
        ev.eventTime <= session.end + this.gap &&
        ev.eventTime >= session.start - this.gap,
    );
  }

  onWatermark(watermark: number, allowed: number): void {
    for (const [key, sessions] of this.open) {
      const remaining: Session[] = [];
      for (const session of sessions) {
        if (watermark >= session.end + allowed) {
          this.closed.push(session);
        } else {
          remaining.push(session);
        }
      }
      if (remaining.length === 0) {
        this.open.delete(key);
      } else {
        this.open.set(key, remaining);
      }
    }
  }

  results(): SessionAgg[] {
    return this.closed
      .map((s) => ({ ...s }))
      .sort((a, b) => {
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return a.start - b.start;
      });
  }
}
