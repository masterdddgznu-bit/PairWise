import { VirtualClock } from "./clock.js";
import { WheelLevel } from "./wheel_level.js";
import { cascadeDown } from "./cascade.js";
import {
  DelayTooLargeError,
  InvalidAdvanceError,
  InvalidDelayError,
} from "./errors.js";
import type { FiredTimer, Timer } from "./types.js";
export type TimerWheelOptions = {
  clock: VirtualClock;
  slotCount?: number;
  levels?: number;
  tickMs?: number;
};
/** Hierarchical timing wheel driven by an injected VirtualClock. */
export class TimerWheel {
  readonly clock: VirtualClock;
  private readonly slotCount: number;
  private readonly tickMs: number;
  private readonly levels: WheelLevel[];
  private readonly timers = new Map<string, Timer>();
  private seq = 0;

  constructor(opts: TimerWheelOptions) {
    this.clock = opts.clock;
    this.slotCount = opts.slotCount ?? 8;
    this.tickMs = opts.tickMs ?? 1;
    const levelCount = opts.levels ?? 3;
    this.levels = [];
    for (let i = 0; i < levelCount; i++) {
      this.levels.push(
        new WheelLevel(this.slotCount, this.tickMs * this.slotCount ** i),
      );
    }
  }

  /** Maximum delay representable by the wheel: tickMs * slotCount^levels - 1. */
  maxDelay(): number {
    return this.tickMs * this.slotCount ** this.levels.length - 1;
  }

  pendingCount(): number {
    return this.timers.size;
  }

  schedule(id: string, delayMs: number, payload: string): void {
    if (delayMs < 0) throw new InvalidDelayError();
    if (delayMs > this.maxDelay()) throw new DelayTooLargeError();
    if (this.timers.has(id)) this.cancel(id);
    const timer: Timer = {
      id,
      payload,
      deadline: this.clock.now() + delayMs,
      seq: ++this.seq,
    };
    for (const level of this.levels) {
      if (level.accepts(timer.deadline)) {
        level.add(timer);
        this.timers.set(id, timer);
        return;
      }
    }
    throw new DelayTooLargeError();
  }

  cancel(id: string): boolean {
    if (!this.timers.has(id)) return false;
    for (const level of this.levels) {
      if (level.removeById(id)) break;
    }
    this.timers.delete(id);
    return true;
  }

  advance(toTime: number): FiredTimer[] {
    if (toTime < this.clock.now()) throw new InvalidAdvanceError();
    const fired: Timer[] = [];
    while (this.clock.now() < toTime) {
      const next = Math.min(this.clock.now() + this.tickMs, toTime);
      this.clock.set(next);
      this.processElapsed(fired);
    }
    this.collectDue(fired);
    for (const t of fired) this.timers.delete(t.id);
    fired.sort((a, b) => a.deadline - b.deadline || a.seq - b.seq);
    return fired.map(({ id, payload, deadline }) => ({ id, payload, deadline }));
  }

  tick(): FiredTimer[] {
    return this.advance(this.clock.now() + this.tickMs);
  }

  /** Advance every level's cursor past all slots elapsed by the current time. */
  private processElapsed(fired: Timer[]): void {
    const now = this.clock.now();
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      while ((level.getCursor() + 1) * level.slotMs <= now) {
        const [departed, current] = level.advanceOne();
        if (i === 0) {
          // Departed level-0 slots only hold timers whose deadline <= now.
          for (const t of departed) fired.push(t);
          for (const t of current) {
            if (t.deadline <= now) fired.push(t);
            else level.add(t);
          }
        } else {
          cascadeDown(current, this.levels, i);
        }
      }
    }
  }

  /** Fire any timer in the current level-0 slot whose deadline has passed. */
  private collectDue(fired: Timer[]): void {
    const now = this.clock.now();
    const level0 = this.levels[0];
    const due = level0.takeSlot(level0.currentIndex());
    for (const t of due) {
      if (t.deadline <= now) fired.push(t);
      else level0.add(t);
    }
  }
}
