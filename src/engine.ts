import { VirtualClock } from "./clock.js";
import { IdRegistry } from "./idempotency.js";
import { WatermarkTrack } from "./watermark.js";
import { TumblingWindows } from "./tumbling.js";
import { SessionWindows } from "./session.js";
import { SideOutput } from "./side.js";
import { ProcessingTriggers } from "./triggers.js";
import type {
  Agg,
  EmitResult,
  LateWinOpts,
  SessionAgg,
  StreamEvent,
} from "./types.js";

/**
 * Late-data window engine.
 * Base put/get/delete/has/keys/size work (arrival-order latest).
 */
export class LateWin {
  readonly clock: VirtualClock;
  private readonly map = new Map<string, number>();
  private readonly allowedLateness: number;
  private readonly ids = new IdRegistry();
  private readonly watermarkTrack = new WatermarkTrack();
  private readonly tumblingWindows = new TumblingWindows();
  private readonly sessionWindows = new SessionWindows();
  private readonly sideOutput_ = new SideOutput();
  private readonly triggers = new ProcessingTriggers();

  constructor(clock?: VirtualClock, opts?: LateWinOpts) {
    this.clock = clock ?? new VirtualClock();
    this.allowedLateness = opts?.allowedLateness ?? 0;
  }

  put(key: string, value: number): void {
    this.map.set(key, value);
  }

  get(key: string): number | undefined {
    return this.map.get(key);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  size(): number {
    return this.map.size;
  }

  emit(ev: StreamEvent): EmitResult {
    if (!this.ids.check(ev.id)) return "duplicate";

    const tumblingEnabled = this.tumblingWindows.enabled();
    let tumblingLate = false;
    if (tumblingEnabled) {
      const outcome = this.tumblingWindows.onEvent(ev);
      if (outcome === "late") tumblingLate = true;
    }

    if (tumblingLate) {
      this.sideOutput_.push(ev);
      return "late";
    }

    if (this.sessionWindows.enabled()) {
      const outcome = this.sessionWindows.onEvent(
        ev,
        !tumblingEnabled,
      );
      if (outcome === "late") {
        this.sideOutput_.push(ev);
        return "late";
      }
    }

    return "ok";
  }

  advanceWatermark(t: number): void {
    this.watermarkTrack.advance(t);
    const wm = this.watermarkTrack.value();
    this.tumblingWindows.onWatermark(wm, this.allowedLateness);
    this.sessionWindows.onWatermark(wm, this.allowedLateness);
  }

  watermark(): number {
    return this.watermarkTrack.value();
  }

  enableTumbling(size: number): void {
    this.tumblingWindows.enable(size);
  }

  tumblingResult(start: number): Agg[] {
    return this.tumblingWindows.result(start);
  }

  closedTumbling(): number[] {
    return this.tumblingWindows.closed();
  }

  sideOutput(): StreamEvent[] {
    return this.sideOutput_.list();
  }

  enableSession(gap: number): void {
    this.sessionWindows.enable(gap);
  }

  sessionResults(): SessionAgg[] {
    return this.sessionWindows.results();
  }

  armProcessingTrigger(windowStart: number, fireAt: number): void {
    this.triggers.arm(windowStart, fireAt);
  }

  tick(): void {
    this.triggers.tick(this.clock.now(), (start) =>
      this.tumblingWindows.snapshot(start),
    );
  }

  triggeredResults(windowStart: number): Agg[] | null {
    return this.triggers.get(windowStart);
  }

  /** expose for silence unused in starter */
  protected allowed(): number {
    return this.allowedLateness;
  }
}
