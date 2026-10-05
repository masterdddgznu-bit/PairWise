import { VirtualClock } from "./clock.js";
import { InvalidConfigError, InvalidEventError } from "./errors.js";

export type Side = "L" | "R";

export interface Join {
  key: string;
  left: unknown;
  right: unknown;
  eventTimeL: number;
  eventTimeR: number;
}

export interface Single {
  key: string;
  side: Side;
  value: unknown;
  eventTime: number;
}

export interface DriveResult {
  joined: Join[];
  singles: Single[];
  droppedLate: number;
}

export interface LagJoinOptions {
  clock: VirtualClock;
  maxLagMs: number;
  waitMs: number;
  maxBufferedPerKey?: number;
}

export type IngestResult = "buffered" | "joined" | "late" | "dropped";

interface Buffered {
  key: string;
  side: Side;
  eventTime: number;
  value: unknown;
  enqueuedAt: number;
  seq: number;
}

interface PendingJoin extends Join {
  lseq: number;
  rseq: number;
}

const SIDES: readonly Side[] = ["L", "R"];

function earliestIndex(items: Buffered[]): number {
  let best = 0;
  for (let i = 1; i < items.length; i++) {
    const a = items[i];
    const b = items[best];
    if (a.eventTime < b.eventTime || (a.eventTime === b.eventTime && a.seq < b.seq)) {
      best = i;
    }
  }
  return best;
}

export class LagJoin {
  private readonly clock: VirtualClock;
  private readonly maxLagMs: number;
  private readonly waitMs: number;
  private readonly maxBufferedPerKey: number;
  private seq = 0;
  private readonly watermarks: Record<Side, number> = { L: -Infinity, R: -Infinity };
  private readonly buffers: Record<Side, Map<string, Buffered[]>> = {
    L: new Map(),
    R: new Map(),
  };
  private pendingJoins: PendingJoin[] = [];

  constructor(options: LagJoinOptions) {
    const opts = options ?? ({} as LagJoinOptions);
    const { clock, maxLagMs, waitMs, maxBufferedPerKey = 8 } = opts;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (typeof maxLagMs !== "number" || !Number.isFinite(maxLagMs) || maxLagMs < 0) {
      throw new InvalidConfigError("maxLagMs must be a finite number >= 0");
    }
    if (typeof waitMs !== "number" || !Number.isFinite(waitMs) || waitMs < 1) {
      throw new InvalidConfigError("waitMs must be a finite number >= 1");
    }
    if (
      typeof maxBufferedPerKey !== "number" ||
      !Number.isFinite(maxBufferedPerKey) ||
      maxBufferedPerKey < 1
    ) {
      throw new InvalidConfigError("maxBufferedPerKey must be a finite number >= 1");
    }
    this.clock = clock;
    this.maxLagMs = maxLagMs;
    this.waitMs = waitMs;
    this.maxBufferedPerKey = maxBufferedPerKey;
  }

  private watermarkValue(): number {
    return Math.min(this.watermarks.L, this.watermarks.R);
  }

  watermark(): number | null {
    const w = this.watermarkValue();
    return Number.isFinite(w) ? w : null;
  }

  bufferedCount(side: Side, key: string): number {
    return this.buffers[side]?.get(key)?.length ?? 0;
  }

  bufferedKeys(side: Side): string[] {
    const map = this.buffers[side];
    if (!map) return [];
    return [...map.keys()].sort();
  }

  ingest(side: Side, key: string, eventTime: number, value: unknown): IngestResult {
    if (side !== "L" && side !== "R") {
      throw new InvalidEventError('side must be "L" or "R"');
    }
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidEventError("key must be a non-empty string");
    }
    if (typeof eventTime !== "number" || !Number.isFinite(eventTime) || eventTime < 0) {
      throw new InvalidEventError("eventTime must be a finite number >= 0");
    }

    const w = this.watermarkValue();
    if (Number.isFinite(w) && eventTime < w - this.maxLagMs) {
      return "late";
    }

    if (eventTime > this.watermarks[side]) {
      this.watermarks[side] = eventTime;
    }

    const other: Side = side === "L" ? "R" : "L";
    const otherBuf = this.buffers[other].get(key);
    if (otherBuf && otherBuf.length > 0) {
      const match = otherBuf.splice(earliestIndex(otherBuf), 1)[0];
      if (otherBuf.length === 0) this.buffers[other].delete(key);
      const seq = ++this.seq;
      const join: PendingJoin =
        side === "L"
          ? {
              key,
              left: value,
              right: match.value,
              eventTimeL: eventTime,
              eventTimeR: match.eventTime,
              lseq: seq,
              rseq: match.seq,
            }
          : {
              key,
              left: match.value,
              right: value,
              eventTimeL: match.eventTime,
              eventTimeR: eventTime,
              lseq: match.seq,
              rseq: seq,
            };
      this.pendingJoins.push(join);
      return "joined";
    }

    const item: Buffered = {
      key,
      side,
      eventTime,
      value,
      enqueuedAt: this.clock.now(),
      seq: ++this.seq,
    };
    const buf = this.buffers[side].get(key);
    if (buf && buf.length >= this.maxBufferedPerKey) {
      buf.splice(earliestIndex(buf), 1);
      buf.push(item);
      return "dropped";
    }
    if (buf) {
      buf.push(item);
    } else {
      this.buffers[side].set(key, [item]);
    }
    return "buffered";
  }

  drive(): DriveResult {
    let droppedLate = 0;
    const w = this.watermarkValue();
    if (Number.isFinite(w)) {
      const threshold = w - this.maxLagMs;
      for (const side of SIDES) {
        for (const [key, buf] of this.buffers[side]) {
          const kept = buf.filter((it) => it.eventTime >= threshold);
          droppedLate += buf.length - kept.length;
          if (kept.length === 0) {
            this.buffers[side].delete(key);
          } else if (kept.length !== buf.length) {
            this.buffers[side].set(key, kept);
          }
        }
      }
    }

    const formed: PendingJoin[] = [];
    for (const [key, lbuf] of this.buffers.L) {
      const rbuf = this.buffers.R.get(key);
      if (!rbuf || rbuf.length === 0) continue;
      while (lbuf.length > 0 && rbuf.length > 0) {
        const left = lbuf.splice(earliestIndex(lbuf), 1)[0];
        const right = rbuf.splice(earliestIndex(rbuf), 1)[0];
        formed.push({
          key,
          left: left.value,
          right: right.value,
          eventTimeL: left.eventTime,
          eventTimeR: right.eventTime,
          lseq: left.seq,
          rseq: right.seq,
        });
      }
      if (lbuf.length === 0) this.buffers.L.delete(key);
      if (rbuf.length === 0) this.buffers.R.delete(key);
    }

    const joined = [...this.pendingJoins, ...formed];
    this.pendingJoins = [];
    joined.sort(
      (a, b) =>
        a.eventTimeL + a.eventTimeR - (b.eventTimeL + b.eventTimeR) ||
        a.lseq - b.lseq ||
        a.rseq - b.rseq,
    );

    const now = this.clock.now();
    const singles: Array<Single & { seq: number }> = [];
    for (const side of SIDES) {
      for (const [key, buf] of this.buffers[side]) {
        const kept: Buffered[] = [];
        for (const it of buf) {
          if (now - it.enqueuedAt >= this.waitMs) {
            singles.push({
              key: it.key,
              side: it.side,
              value: it.value,
              eventTime: it.eventTime,
              seq: it.seq,
            });
          } else {
            kept.push(it);
          }
        }
        if (kept.length === 0) {
          this.buffers[side].delete(key);
        } else if (kept.length !== buf.length) {
          this.buffers[side].set(key, kept);
        }
      }
    }
    singles.sort(
      (a, b) =>
        a.eventTime - b.eventTime ||
        (a.side === b.side ? a.seq - b.seq : a.side === "L" ? -1 : 1),
    );

    return {
      joined: joined.map(({ lseq, rseq, ...j }) => j),
      singles: singles.map(({ seq, ...s }) => s),
      droppedLate,
    };
  }
}
