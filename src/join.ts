import type { VirtualClock } from "./clock.js";
import type { Event, JoinOut, Side } from "./types.js";
import { SideWatermark } from "./watermark.js";
import { SpanJoinError } from "./errors.js";

/** Event-time interval join with per-side watermarks. */
export class SpanJoin {
  private readonly left = new Map<string, Event[]>();
  private readonly right = new Map<string, Event[]>();
  private readonly emitted = new Set<string>();
  private readonly out: JoinOut[] = [];
  private readonly late: Event[] = [];
  private readonly wm = new SideWatermark();

  constructor(
    private readonly clock: VirtualClock,
    private readonly spanMs: number,
    private readonly maxLatenessMs: number,
  ) {
    if (!Number.isFinite(spanMs) || spanMs < 0) {
      throw new SpanJoinError("spanMs must be a finite, non-negative number");
    }
    if (!Number.isFinite(maxLatenessMs) || maxLatenessMs < 0) {
      throw new SpanJoinError(
        "maxLatenessMs must be a finite, non-negative number",
      );
    }
  }

  ingestLeft(e: Event): void {
    this.ingest(e, "L", this.left, this.right);
  }

  ingestRight(e: Event): void {
    this.ingest(e, "R", this.right, this.left);
  }

  advanceWatermark(side: Side, wm: number): void {
    this.wm.advance(side, wm);
    this.gc();
  }

  watermark(side: Side): number {
    return this.wm.value(side);
  }

  earlyFire(procDeadline: number): void {
    if (this.clock.now() < procDeadline) {
      return;
    }
    for (const [key, lefts] of this.left) {
      const rights = this.right.get(key);
      if (!rights) {
        continue;
      }
      for (const l of lefts) {
        for (const r of rights) {
          this.tryEmit(l, r);
        }
      }
    }
  }

  results(): JoinOut[] {
    return [...this.out]
      .sort((a, b) => a.eventTime - b.eventTime || (a.id < b.id ? -1 : 1))
      .map((o) => ({ ...o, left: { ...o.left }, right: { ...o.right } }));
  }

  lateOutput(): Event[] {
    return [...this.late]
      .sort((a, b) => a.eventTime - b.eventTime || (a.id < b.id ? -1 : 1))
      .map((e) => ({ ...e }));
  }

  buffered(side: Side): number {
    const buffer = side === "L" ? this.left : this.right;
    let n = 0;
    for (const events of buffer.values()) {
      n += events.length;
    }
    return n;
  }

  private ingest(
    e: Event,
    side: Side,
    own: Map<string, Event[]>,
    other: Map<string, Event[]>,
  ): void {
    const event: Event = { ...e };
    if (event.eventTime < this.wm.value(side)) {
      this.late.push(event);
      return;
    }
    this.wm.observe(side, event.eventTime, this.maxLatenessMs);
    const bucket = own.get(event.key);
    if (bucket) {
      bucket.push(event);
    } else {
      own.set(event.key, [event]);
    }
    const peers = other.get(event.key);
    if (peers) {
      for (const peer of peers) {
        if (side === "L") {
          this.tryEmit(event, peer);
        } else {
          this.tryEmit(peer, event);
        }
      }
    }
    this.gc();
  }

  private tryEmit(l: Event, r: Event): void {
    if (Math.abs(l.eventTime - r.eventTime) > this.spanMs) {
      return;
    }
    const id = `${l.id}:${r.id}`;
    if (this.emitted.has(id)) {
      return;
    }
    this.emitted.add(id);
    this.out.push({
      id,
      key: l.key,
      left: { ...l },
      right: { ...r },
      eventTime: Math.max(l.eventTime, r.eventTime),
    });
  }

  private gc(): void {
    const cutoff = Math.min(this.wm.value("L"), this.wm.value("R")) - this.spanMs;
    this.prune(this.left, cutoff);
    this.prune(this.right, cutoff);
  }

  private prune(buffer: Map<string, Event[]>, cutoff: number): void {
    for (const [key, events] of buffer) {
      const kept = events.filter((e) => e.eventTime >= cutoff);
      if (kept.length === 0) {
        buffer.delete(key);
      } else if (kept.length !== events.length) {
        buffer.set(key, kept);
      }
    }
  }
}
