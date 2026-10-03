import { VirtualClock } from "./clock.js";
import {
  InvalidCheckpointError,
  InvalidConfigError,
  InvalidEventError,
} from "./errors.js";
import { WindowTable } from "./windows.js";
import { WatermarkTrack } from "./watermark.js";
import { LateBuffer } from "./late.js";
import { encode, decode } from "./checkpoint.js";
import type { Emit, IngestResult, LateEvent, WaterMeshOptions } from "./types.js";

type Snapshot = {
  version: 1;
  watermark: number;
  windows: unknown;
  results: Emit[];
  late: LateEvent[];
  procTime: number;
};

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isEmit(v: unknown): v is Emit {
  const e = v as Emit;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.key === "string" &&
    isNum(e.windowStart) &&
    isNum(e.windowEnd) &&
    isNum(e.count) &&
    isNum(e.sum)
  );
}

function isLateEvent(v: unknown): v is LateEvent {
  const e = v as LateEvent;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof e.key === "string" &&
    isNum(e.eventTime) &&
    typeof e.payload === "string" &&
    isNum(e.windowStart)
  );
}

function isWindowDump(
  v: unknown,
): v is { open: Array<{ key: string; start: number; count: number; sum: number }>; closed: Array<[string, number]> } {
  const d = v as { open?: unknown; closed?: unknown };
  if (typeof d !== "object" || d === null) return false;
  if (!Array.isArray(d.open) || !Array.isArray(d.closed)) return false;
  for (const e of d.open) {
    const o = e as { key?: unknown; start?: unknown; count?: unknown; sum?: unknown };
    if (
      typeof o !== "object" ||
      o === null ||
      typeof o.key !== "string" ||
      !isNum(o.start) ||
      !isNum(o.count) ||
      !isNum(o.sum)
    ) {
      return false;
    }
  }
  for (const c of d.closed) {
    if (!Array.isArray(c) || c.length !== 2) return false;
    if (typeof c[0] !== "string" || !isNum(c[1])) return false;
  }
  return true;
}

export class WaterMesh {
  readonly clock: VirtualClock;
  private readonly windowSize: number;
  private readonly allowedLateness: number;
  private readonly windows = new WindowTable();
  private readonly watermarks = new WatermarkTrack();
  private readonly late = new LateBuffer();
  private results: Emit[] = [];

  constructor(opts: WaterMeshOptions) {
    if (!opts || !opts.clock) throw new InvalidConfigError("clock is required");
    if (!isNum(opts.windowSize) || opts.windowSize < 1) {
      throw new InvalidConfigError("windowSize must be a finite number >= 1");
    }
    if (!isNum(opts.allowedLateness) || opts.allowedLateness < 0) {
      throw new InvalidConfigError("allowedLateness must be a finite number >= 0");
    }
    this.clock = opts.clock;
    this.windowSize = opts.windowSize;
    this.allowedLateness = opts.allowedLateness;
  }

  watermark(): number {
    return this.watermarks.current();
  }

  ingest(key: string, eventTime: number, payload: string): IngestResult {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidEventError("key must be a non-empty string");
    }
    if (!isNum(eventTime)) {
      throw new InvalidEventError("eventTime must be a finite number");
    }
    const wm = this.watermarks.current();
    if (eventTime < wm - this.allowedLateness) return "drop";
    const start = this.windows.windowStart(eventTime, this.windowSize);
    if (start + this.windowSize <= wm) {
      this.late.push({ key, eventTime, payload, windowStart: start });
      return "late";
    }
    this.windows.add(key, start, payload);
    return "ok";
  }

  raiseWatermark(wm: number): Emit[] {
    const prev = this.watermarks.current();
    this.watermarks.raise(wm);
    if (wm === prev) return [];
    const due = this.windows
      .openEntries(this.windowSize)
      .filter((e) => e.start + this.windowSize <= wm)
      .sort(
        (a, b) =>
          a.start - b.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      );
    const emitted: Emit[] = [];
    for (const e of due) {
      this.windows.markClosed(e.key, e.start);
      emitted.push({
        key: e.key,
        windowStart: e.start,
        windowEnd: e.start + this.windowSize,
        count: e.agg.count,
        sum: e.agg.sum,
      });
    }
    this.results.push(...emitted);
    return emitted;
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
    return this.windows.openCount();
  }

  closedWindowCount(): number {
    return this.windows.closedCount();
  }

  checkpoint(): string {
    const snapshot: Snapshot = {
      version: 1,
      watermark: this.watermarks.exportAll(),
      windows: this.windows.exportAll(),
      results: this.results.map((e) => ({ ...e })),
      late: this.late.exportAll(),
      procTime: this.clock.now(),
    };
    return encode(snapshot);
  }

  restore(json: string): void {
    const data = decode(json) as Partial<Snapshot>;
    if (typeof data !== "object" || data === null) {
      throw new InvalidCheckpointError("checkpoint must be an object");
    }
    if (typeof data.watermark !== "number") {
      throw new InvalidCheckpointError("checkpoint watermark is invalid");
    }
    if (!isWindowDump(data.windows)) {
      throw new InvalidCheckpointError("checkpoint windows are invalid");
    }
    if (!Array.isArray(data.results) || !data.results.every(isEmit)) {
      throw new InvalidCheckpointError("checkpoint results are invalid");
    }
    if (!Array.isArray(data.late) || !data.late.every(isLateEvent)) {
      throw new InvalidCheckpointError("checkpoint late events are invalid");
    }
    this.watermarks.importAll(data.watermark);
    this.windows.importAll(data.windows);
    this.results = data.results.map((e) => ({ ...e }));
    this.late.importAll(data.late);
  }
}
