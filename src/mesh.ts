import { VirtualClock } from "./clock.js";
import { encode, decode } from "./checkpoint.js";
import {
  InvalidCheckpointError,
  InvalidConfigError,
  InvalidEventError,
} from "./errors.js";
import { LateBuffer } from "./late.js";
import type { Emit, IngestResult, LateEvent, WaterMeshOptions } from "./types.js";
import { WatermarkTrack } from "./watermark.js";
import { WindowTable, windowStartOf } from "./windows.js";

type Snapshot = {
  watermark: number;
  windows: unknown;
  results: Emit[];
  late: LateEvent[];
  procTime: number;
};

export class WaterMesh {
  readonly clock: VirtualClock;
  private readonly windowSize: number;
  private readonly allowedLateness: number;
  private readonly track = new WatermarkTrack();
  private readonly table = new WindowTable();
  private readonly late = new LateBuffer();
  private results: Emit[] = [];

  constructor(opts: WaterMeshOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    if (
      !Number.isFinite(opts.windowSize) ||
      opts.windowSize < 1
    ) {
      throw new InvalidConfigError("windowSize must be >= 1");
    }
    if (
      !Number.isFinite(opts.allowedLateness) ||
      opts.allowedLateness < 0
    ) {
      throw new InvalidConfigError("allowedLateness must be >= 0");
    }
    this.clock = opts.clock;
    this.windowSize = opts.windowSize;
    this.allowedLateness = opts.allowedLateness;
  }

  watermark(): number {
    return this.track.current();
  }

  ingest(key: string, eventTime: number, payload: string): IngestResult {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidEventError("key must be a non-empty string");
    }
    if (!Number.isFinite(eventTime)) {
      throw new InvalidEventError("eventTime must be finite");
    }
    const wm = this.track.current();
    if (eventTime < wm - this.allowedLateness) {
      return "drop";
    }
    const start = windowStartOf(eventTime, this.windowSize);
    if (start + this.windowSize <= wm || this.table.isClosed(key, start)) {
      this.late.push({ key, eventTime, payload, windowStart: start });
      return "late";
    }
    this.table.add(key, start, payload);
    return "ok";
  }

  raiseWatermark(wm: number): Emit[] {
    this.track.raise(wm);
    const closing = this.table
      .openEntries(this.windowSize)
      .filter((e) => e.start + this.windowSize <= wm);
    closing.sort((a, b) =>
      a.start !== b.start ? a.start - b.start : a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
    );
    const fired: Emit[] = closing.map((e) => {
      this.table.markClosed(e.key, e.start);
      return {
        key: e.key,
        windowStart: e.start,
        windowEnd: e.start + this.windowSize,
        count: e.agg.count,
        sum: e.agg.sum,
      };
    });
    this.results.push(...fired);
    return fired;
  }

  pollResults(): Emit[] {
    const out = this.results;
    this.results = [];
    return out;
  }

  pollLate(): LateEvent[] {
    return this.late.drain();
  }

  openWindowCount(): number {
    return this.table.openCount();
  }

  closedWindowCount(): number {
    return this.table.closedCount();
  }

  checkpoint(): string {
    const snap: Snapshot = {
      watermark: this.track.current(),
      windows: this.table.exportAll(),
      results: this.results.map((e) => ({ ...e })),
      late: this.late.exportAll(),
      procTime: this.clock.now(),
    };
    return encode(snap);
  }

  restore(json: string): void {
    const snap = decode(json) as Snapshot;
    try {
      if (
        typeof snap !== "object" ||
        snap === null ||
        (typeof snap.watermark !== "number" && snap.watermark !== null) ||
        !Array.isArray(snap.results) ||
        !Array.isArray(snap.late) ||
        typeof snap.windows !== "object" ||
        snap.windows === null
      ) {
        throw new InvalidCheckpointError("malformed checkpoint");
      }
      this.track.importAll(snap.watermark === null ? Number.NEGATIVE_INFINITY : snap.watermark);
      this.table.importAll(snap.windows);
      this.results = snap.results.map((e) => ({ ...e }));
      this.late.importAll(snap.late);
    } catch (err) {
      if (err instanceof InvalidCheckpointError) throw err;
      throw new InvalidCheckpointError("malformed checkpoint");
    }
  }
}
