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
  eventTime: number;
  value: unknown;
  seq: number;
  enqueuedAt: number;
}

interface PendingJoin extends Join {
  completed: number;
}

const SIDES: readonly Side[] = ["L", "R"];

export class LagJoin {
  private readonly clock: VirtualClock;
  private readonly maxLagMs: number;
  private readonly waitMs: number;
  private readonly maxBufferedPerKey: number;
  private readonly buffers: Record<Side, Map<string, Buffered[]>> = {
    L: new Map(),
    R: new Map(),
  };
  private readonly watermarks: Record<Side, number> = {
    L: -Infinity,
    R: -Infinity,
  };
  private nextSeq = 1;
  private nextCompleted = 1;
  private pendingJoins: PendingJoin[] = [];

  constructor(options: LagJoinOptions) {
    if (options === null || typeof options !== "object") {
      throw new InvalidConfigError("LagJoin requires an options object");
    }
    const { clock, maxLagMs, waitMs } = options;
    const maxBufferedPerKey = options.maxBufferedPerKey ?? 8;
    if (!(clock instanceof VirtualClock)) {
      throw new InvalidConfigError("clock must be a VirtualClock");
    }
    if (!Number.isFinite(maxLagMs) || maxLagMs < 0) {
      throw new InvalidConfigError(
        `maxLagMs must be a finite number >= 0, got ${String(maxLagMs)}`,
      );
    }
    if (!Number.isFinite(waitMs) || waitMs < 1) {
      throw new InvalidConfigError(
        `waitMs must be a finite number >= 1, got ${String(waitMs)}`,
      );
    }
    if (!Number.isFinite(maxBufferedPerKey) || maxBufferedPerKey < 1) {
      throw new InvalidConfigError(
        `maxBufferedPerKey must be a finite number >= 1, got ${String(maxBufferedPerKey)}`,
      );
    }
    this.clock = clock;
    this.maxLagMs = maxLagMs;
    this.waitMs = waitMs;
    this.maxBufferedPerKey = maxBufferedPerKey;
  }

  ingest(
    side: Side,
    key: string,
    eventTime: number,
    value: unknown,
  ): IngestResult {
    if (side !== "L" && side !== "R") {
      throw new InvalidEventError(`side must be "L" or "R", got ${String(side)}`);
    }
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidEventError("key must be a non-empty string");
    }
    if (
      typeof eventTime !== "number" ||
      !Number.isFinite(eventTime) ||
      eventTime < 0
    ) {
      throw new InvalidEventError(
        `eventTime must be a finite number >= 0, got ${String(eventTime)}`,
      );
    }

    if (eventTime > this.watermarks[side]) {
      this.watermarks[side] = eventTime;
    }

    const w = this.watermark();
    if (w !== null && eventTime < w - this.maxLagMs) {
      return "late";
    }

    const opposite: Side = side === "L" ? "R" : "L";
    const oppBuf = this.buffers[opposite].get(key);
    if (oppBuf !== undefined && oppBuf.length > 0) {
      const other = oppBuf.shift() as Buffered;
      if (oppBuf.length === 0) {
        this.buffers[opposite].delete(key);
      }
      const join: PendingJoin =
        side === "L"
          ? {
              key,
              left: value,
              right: other.value,
              eventTimeL: eventTime,
              eventTimeR: other.eventTime,
              completed: this.nextCompleted++,
            }
          : {
              key,
              left: other.value,
              right: value,
              eventTimeL: other.eventTime,
              eventTimeR: eventTime,
              completed: this.nextCompleted++,
            };
      this.pendingJoins.push(join);
      return "joined";
    }

    const record: Buffered = {
      key,
      eventTime,
      value,
      seq: this.nextSeq++,
      enqueuedAt: this.clock.now(),
    };
    let buf = this.buffers[side].get(key);
    if (buf === undefined) {
      buf = [];
      this.buffers[side].set(key, buf);
    }
    let result: IngestResult = "buffered";
    if (buf.length >= this.maxBufferedPerKey) {
      buf.shift();
      result = "dropped";
    }
    let at = buf.length;
    while (at > 0 && (buf[at - 1] as Buffered).eventTime > eventTime) {
      at -= 1;
    }
    buf.splice(at, 0, record);
    return result;
  }

  drive(): DriveResult {
    let droppedLate = 0;

    const w = this.watermark();
    if (w !== null) {
      const threshold = w - this.maxLagMs;
      for (const side of SIDES) {
        const map = this.buffers[side];
        for (const [key, buf] of map) {
          const kept = buf.filter((r) => r.eventTime >= threshold);
          droppedLate += buf.length - kept.length;
          if (kept.length === 0) {
            map.delete(key);
          } else if (kept.length !== buf.length) {
            map.set(key, kept);
          }
        }
      }
    }

    const pairs: Array<{ l: Buffered; r: Buffered }> = [];
    for (const [key, lbuf] of this.buffers.L) {
      const rbuf = this.buffers.R.get(key);
      if (rbuf === undefined || rbuf.length === 0) {
        continue;
      }
      const n = Math.min(lbuf.length, rbuf.length);
      for (let i = 0; i < n; i += 1) {
        pairs.push({ l: lbuf[i] as Buffered, r: rbuf[i] as Buffered });
      }
      lbuf.splice(0, n);
      rbuf.splice(0, n);
      if (lbuf.length === 0) {
        this.buffers.L.delete(key);
      }
      if (rbuf.length === 0) {
        this.buffers.R.delete(key);
      }
    }
    pairs.sort((a, b) => a.l.seq - b.l.seq || a.r.seq - b.r.seq);
    for (const { l, r } of pairs) {
      this.pendingJoins.push({
        key: l.key,
        left: l.value,
        right: r.value,
        eventTimeL: l.eventTime,
        eventTimeR: r.eventTime,
        completed: this.nextCompleted++,
      });
    }

    const joined: Join[] = this.pendingJoins
      .sort(
        (a, b) =>
          a.eventTimeL + a.eventTimeR - (b.eventTimeL + b.eventTimeR) ||
          a.completed - b.completed,
      )
      .map(({ key, left, right, eventTimeL, eventTimeR }) => ({
        key,
        left,
        right,
        eventTimeL,
        eventTimeR,
      }));
    this.pendingJoins = [];

    const now = this.clock.now();
    const due: Array<Single & { seq: number }> = [];
    for (const side of SIDES) {
      const map = this.buffers[side];
      for (const [key, buf] of map) {
        const kept: Buffered[] = [];
        for (const r of buf) {
          if (now - r.enqueuedAt >= this.waitMs) {
            due.push({
              key,
              side,
              value: r.value,
              eventTime: r.eventTime,
              seq: r.seq,
            });
          } else {
            kept.push(r);
          }
        }
        if (kept.length === 0) {
          map.delete(key);
        } else if (kept.length !== buf.length) {
          map.set(key, kept);
        }
      }
    }
    due.sort(
      (a, b) =>
        a.eventTime - b.eventTime ||
        (a.side === b.side ? a.seq - b.seq : a.side === "L" ? -1 : 1),
    );
    const singles: Single[] = due.map(({ key, side, value, eventTime }) => ({
      key,
      side,
      value,
      eventTime,
    }));

    return { joined, singles, droppedLate };
  }

  watermark(): number | null {
    const w = Math.min(this.watermarks.L, this.watermarks.R);
    return w === -Infinity ? null : w;
  }

  bufferedCount(side: Side, key: string): number {
    this.assertSide(side);
    return this.buffers[side].get(key)?.length ?? 0;
  }

  bufferedKeys(side: Side): string[] {
    this.assertSide(side);
    return [...this.buffers[side].keys()].sort();
  }

  private assertSide(side: Side): void {
    if (side !== "L" && side !== "R") {
      throw new InvalidEventError(`side must be "L" or "R", got ${String(side)}`);
    }
  }
}
