import { VirtualClock } from "./clock.js";
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

  emit(_ev: StreamEvent): EmitResult {
    throw new Error("emit not implemented");
  }

  advanceWatermark(_t: number): void {
    throw new Error("advanceWatermark not implemented");
  }

  watermark(): number {
    throw new Error("watermark not implemented");
  }

  enableTumbling(_size: number): void {
    throw new Error("enableTumbling not implemented");
  }

  tumblingResult(_start: number): Agg[] {
    throw new Error("tumblingResult not implemented");
  }

  closedTumbling(): number[] {
    throw new Error("closedTumbling not implemented");
  }

  sideOutput(): StreamEvent[] {
    throw new Error("sideOutput not implemented");
  }

  enableSession(_gap: number): void {
    throw new Error("enableSession not implemented");
  }

  sessionResults(): SessionAgg[] {
    throw new Error("sessionResults not implemented");
  }

  armProcessingTrigger(_windowStart: number, _fireAt: number): void {
    throw new Error("armProcessingTrigger not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  triggeredResults(_windowStart: number): Agg[] | null {
    throw new Error("triggeredResults not implemented");
  }

  /** expose for silence unused in starter */
  protected allowed(): number {
    return this.allowedLateness;
  }
}
