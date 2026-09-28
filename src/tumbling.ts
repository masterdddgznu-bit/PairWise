import type { Agg, StreamEvent } from "./types.js";
import { LateWinError } from "./errors.js";

type AggState = {
  sum: number;
  count: number;
};

type Window = {
  start: number;
  aggs: Map<string, AggState>;
  frozen: Agg[] | null;
};

export class TumblingWindows {
  private size = 0;
  private readonly windows = new Map<number, Window>();

  enable(size: number): void {
    if (!(size > 0)) throw new LateWinError("tumbling size must be > 0");
    this.size = size;
  }

  enabled(): boolean {
    return this.size > 0;
  }

  windowStart(eventTime: number): number {
    return Math.floor(eventTime / this.size) * this.size;
  }

  onEvent(ev: StreamEvent): "ok" | "late" {
    const start = this.windowStart(ev.eventTime);
    const win = this.windows.get(start);
    if (win?.frozen) return "late";
    let w = win;
    if (!w) {
      w = { start, aggs: new Map(), frozen: null };
      this.windows.set(start, w);
    }
    const agg = w.aggs.get(ev.key);
    if (agg) {
      agg.sum += ev.value;
      agg.count += 1;
    } else {
      w.aggs.set(ev.key, { sum: ev.value, count: 1 });
    }
    return "ok";
  }

  onWatermark(watermark: number, allowed: number): void {
    for (const win of this.windows.values()) {
      if (win.frozen) continue;
      if (watermark >= win.start + this.size + allowed) {
        win.frozen = this.toAggs(win.aggs);
      }
    }
  }

  private toAggs(aggs: Map<string, AggState>): Agg[] {
    return [...aggs.keys()]
      .sort()
      .map((key) => {
        const state = aggs.get(key)!;
        return { key, sum: state.sum, count: state.count };
      });
  }

  result(start: number): Agg[] {
    const win = this.windows.get(start);
    if (!win) return [];
    if (win.frozen) return win.frozen.map((a) => ({ ...a }));
    return this.toAggs(win.aggs);
  }

  closed(): number[] {
    return [...this.windows.values()]
      .filter((w) => w.frozen !== null)
      .map((w) => w.start)
      .sort((a, b) => a - b);
  }

  snapshot(start: number): Agg[] | null {
    const win = this.windows.get(start);
    if (!win || win.frozen) return null;
    return this.toAggs(win.aggs);
  }
}
