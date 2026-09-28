import type { Agg, StreamEvent } from "./types.js";
import { LateWinError } from "./errors.js";

type LiveWindow = {
  start: number;
  size: number;
  agg: Map<string, Agg>;
  closed: boolean;
};

export class TumblingWindows {
  private windowSize: number | null = null;
  private readonly windows = new Map<number, LiveWindow>();

  enable(size: number): void {
    if (!(size > 0)) throw new LateWinError("tumbling size must be > 0");
    this.windowSize = size;
  }

  enabled(): boolean {
    return this.windowSize !== null;
  }

  private windowStart(eventTime: number): number {
    const size = this.windowSize as number;
    return Math.floor(eventTime / size) * size;
  }

  /** @returns true when the event's tumbling window is still open */
  isOpen(eventTime: number, watermark: number, allowed: number): boolean {
    const start = this.windowStart(eventTime);
    const win = this.windows.get(start);
    if (win && win.closed) return false;
    return watermark < start + (this.windowSize as number) + allowed;
  }

  onEvent(ev: StreamEvent, watermark: number, allowed: number): "ok" | "late" {
    if (!this.isOpen(ev.eventTime, watermark, allowed)) return "late";
    const start = this.windowStart(ev.eventTime);
    let win = this.windows.get(start);
    if (!win) {
      win = {
        start,
        size: this.windowSize as number,
        agg: new Map<string, Agg>(),
        closed: false,
      };
      this.windows.set(start, win);
    }
    let entry = win.agg.get(ev.key);
    if (!entry) {
      entry = { key: ev.key, sum: 0, count: 0 };
      win.agg.set(ev.key, entry);
    }
    entry.sum += ev.value;
    entry.count += 1;
    return "ok";
  }

  onWatermark(watermark: number, allowed: number): void {
    for (const win of this.windows.values()) {
      if (!win.closed && watermark >= win.start + win.size + allowed) {
        win.closed = true;
      }
    }
  }

  private sortedAgg(agg: Map<string, Agg>): Agg[] {
    return [...agg.values()]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((a) => ({ ...a }));
  }

  result(start: number): Agg[] {
    const win = this.windows.get(start);
    if (!win) return [];
    return this.sortedAgg(win.agg);
  }

  closed(): number[] {
    return [...this.windows.values()]
      .filter((w) => w.closed)
      .map((w) => w.start)
      .sort((a, b) => a - b);
  }

  snapshot(start: number): Agg[] | null {
    const win = this.windows.get(start);
    if (!win || win.closed) return null;
    return this.sortedAgg(win.agg);
  }
}
