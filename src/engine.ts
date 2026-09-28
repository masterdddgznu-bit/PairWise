import { VirtualClock } from "./clock.js";
import { LateWinError } from "./errors.js";
import { IdRegistry } from "./idempotency.js";
import { SessionWindows } from "./session.js";
import { SideOutput } from "./side.js";
import { ProcessingTriggers } from "./triggers.js";
import { TumblingWindows } from "./tumbling.js";
import type {
  Agg,
  EmitResult,
  LateWinOpts,
  SessionAgg,
  StreamEvent,
} from "./types.js";
import { WatermarkTrack } from "./watermark.js";

/**
 * Late-data window engine.
 * Base put/get/delete/has/keys/size work (arrival-order latest).
 */
export class LateWin {
  readonly clock: VirtualClock;
  private readonly map = new Map<string, number>();
  private readonly allowedLateness: number;
  private readonly wm = new WatermarkTrack();
  private readonly ids = new IdRegistry();
  private readonly tumbling = new TumblingWindows();
  private readonly sessions = new SessionWindows();
  private readonly side = new SideOutput();
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

    if (
      this.tumbling.enabled() &&
      !this.tumbling.isOpen(ev.eventTime, this.wm.value(), this.allowedLateness)
    ) {
      this.side.push(ev);
      return "late";
    }

    if (this.tumbling.enabled()) this.tumbling.onEvent(ev, this.wm.value(), this.allowedLateness);

    if (this.sessions.enabled()) {
      const sessionResult = this.sessions.onEvent(ev);
      if (sessionResult === "late") {
        this.side.push(ev);
        return "late";
      }
    }

    return "ok";
  }

  advanceWatermark(t: number): void {
    this.wm.advance(t);
    this.tumbling.onWatermark(this.wm.value(), this.allowedLateness);
    this.sessions.onWatermark(this.wm.value(), this.allowedLateness);
  }

  watermark(): number {
    return this.wm.value();
  }

  enableTumbling(size: number): void {
    this.tumbling.enable(size);
  }

  tumblingResult(start: number): Agg[] {
    if (!this.tumbling.enabled()) throw new LateWinError("tumbling not enabled");
    return this.tumbling.result(start);
  }

  closedTumbling(): number[] {
    if (!this.tumbling.enabled()) throw new LateWinError("tumbling not enabled");
    return this.tumbling.closed();
  }

  sideOutput(): StreamEvent[] {
    return this.side.list();
  }

  enableSession(gap: number): void {
    this.sessions.enable(gap);
  }

  sessionResults(): SessionAgg[] {
    if (!this.sessions.enabled()) throw new LateWinError("session not enabled");
    return this.sessions.results();
  }

  armProcessingTrigger(windowStart: number, fireAt: number): void {
    if (!this.tumbling.enabled()) throw new LateWinError("tumbling not enabled");
    this.triggers.arm(windowStart, fireAt);
  }

  tick(): void {
    this.triggers.tick(this.clock.now(), (start) =>
      this.tumbling.snapshot(start),
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
