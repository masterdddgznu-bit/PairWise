import type { VirtualClock } from "./clock.js";
import type { Event, JoinOut, Side } from "./types.js";
import { SideWatermark } from "./watermark.js";
import { SpanJoinError } from "./errors.js";

/** Event-time interval join with per-side watermarks. */
export class SpanJoin {
  private readonly wms: SideWatermark;
  private readonly leftByKey = new Map<string, Map<string, Event>>();
  private readonly rightByKey = new Map<string, Map<string, Event>>();
  private readonly emitted = new Set<string>();
  private readonly out: JoinOut[] = [];
  private readonly late: Event[] = [];

  constructor(
    private readonly clock: VirtualClock,
    private readonly spanMs: number,
    maxLatenessMs: number,
  ) {
    if (!Number.isFinite(spanMs) || spanMs < 0) {
      throw new SpanJoinError("spanMs must be a finite non-negative number");
    }
    if (!Number.isFinite(maxLatenessMs) || maxLatenessMs < 0) {
      throw new SpanJoinError("maxLatenessMs must be a finite non-negative number");
    }
    this.wms = new SideWatermark(maxLatenessMs);
  }

  ingestLeft(e: Event): void {
    this.ingest(e, "L");
  }

  ingestRight(e: Event): void {
    this.ingest(e, "R");
  }

  advanceWatermark(side: Side, wm: number): void {
    this.wms.advance(side, wm);
    this.gc();
  }

  watermark(side: Side): number {
    return this.wms.value(side);
  }

  earlyFire(procDeadline: number): void {
    if (this.clock.now() < procDeadline) {
      return;
    }
    this.emitAllBufferedPairs();
  }

  results(): JoinOut[] {
    return this.sortedOut().map((o) => ({ ...o, left: { ...o.left }, right: { ...o.right } }));
  }

  lateOutput(): Event[] {
    return [...this.late]
      .sort((a, b) => a.eventTime - b.eventTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((e) => ({ ...e }));
  }

  buffered(side: Side): number {
    const index = side === "L" ? this.leftByKey : this.rightByKey;
    let n = 0;
    for (const bucket of index.values()) {
      n += bucket.size;
    }
    return n;
  }

  private ingest(event: Event, side: Side): void {
    if (event.eventTime < this.wms.value(side)) {
      this.late.push({ ...event });
      return;
    }
    this.wms.observe(side, event.eventTime);
    const index = side === "L" ? this.leftByKey : this.rightByKey;
    let bucket = index.get(event.key);
    if (!bucket) {
      bucket = new Map();
      index.set(event.key, bucket);
    }
    bucket.set(event.id, { ...event });
    this.emitPairsFor(event, side);
    this.gc();
  }

  /** Emit span-matching pairs involving the freshly ingested event. */
  private emitPairsFor(event: Event, side: Side): void {
    const opposite = side === "L" ? this.rightByKey : this.leftByKey;
    const bucket = opposite.get(event.key);
    if (!bucket) {
      return;
    }
    for (const other of bucket.values()) {
      if (Math.abs(event.eventTime - other.eventTime) <= this.spanMs) {
        const left = side === "L" ? event : other;
        const right = side === "R" ? event : other;
        this.emit(left, right);
      }
    }
  }

  /** Full scan used by earlyFire. */
  private emitAllBufferedPairs(): void {
    for (const [key, leftBucket] of this.leftByKey) {
      const rightBucket = this.rightByKey.get(key);
      if (!rightBucket) {
        continue;
      }
      for (const left of leftBucket.values()) {
        for (const right of rightBucket.values()) {
          if (Math.abs(left.eventTime - right.eventTime) <= this.spanMs) {
            this.emit(left, right);
          }
        }
      }
    }
  }

  private emit(left: Event, right: Event): void {
    const id = `${left.id}:${right.id}`;
    if (this.emitted.has(id)) {
      return;
    }
    this.emitted.add(id);
    this.out.push({
      id,
      key: left.key,
      left: { ...left },
      right: { ...right },
      eventTime: Math.max(left.eventTime, right.eventTime),
    });
  }

  private gc(): void {
    const minWm = Math.min(this.wms.value("L"), this.wms.value("R"));
    const horizon = minWm - this.spanMs;
    this.dropBefore(this.leftByKey, horizon);
    this.dropBefore(this.rightByKey, horizon);
  }

  private dropBefore(index: Map<string, Map<string, Event>>, horizon: number): void {
    for (const [key, bucket] of index) {
      for (const [id, e] of bucket) {
        if (e.eventTime < horizon) {
          bucket.delete(id);
        }
      }
      if (bucket.size === 0) {
        index.delete(key);
      }
    }
  }

  private sortedOut(): JoinOut[] {
    return [...this.out].sort((a, b) => a.eventTime - b.eventTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}
