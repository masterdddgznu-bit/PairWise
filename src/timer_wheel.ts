import { VirtualClock } from "./clock.js";
import { WheelLevel } from "./wheel_level.js";
import { cascadeDown, placeTimer } from "./cascade.js";
import {
  InvalidDelayError,
  DelayTooLargeError,
  InvalidAdvanceError,
} from "./errors.js";
import type { Timer, FiredTimer } from "./types.js";
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
  private readonly levelCount: number;
  private readonly tickMs: number;
  private readonly levels: WheelLevel[];
  private seqCounter = 0;
  private pending = 0;

  constructor(opts: TimerWheelOptions) {
    this.clock = opts.clock;
    this.slotCount = opts.slotCount ?? 8;
    this.levelCount = opts.levels ?? 3;
    this.tickMs = opts.tickMs ?? 1;
    const now = this.clock.now();
    this.levels = [];
    for (let i = 0; i < this.levelCount; i++) {
      this.levels.push(
        new WheelLevel(this.slotCount, this.tickMs * this.slotCount ** i, now),
      );
    }
  }

  /** Maximum representable delay: total coverage of all levels minus one. */
  maxDelay(): number {
    return this.tickMs * this.slotCount ** this.levelCount - 1;
  }

  pendingCount(): number { return this.pending; }

  schedule(id: string, delayMs: number, payload: string): void {
    if (delayMs < 0) throw new InvalidDelayError();
    if (delayMs > this.maxDelay()) throw new DelayTooLargeError();
    this.cancel(id);
    const timer: Timer = {
      id,
      payload,
      deadline: this.clock.now() + delayMs,
      seq: this.seqCounter++,
    };
    placeTimer(timer, this.levels, this.clock.now());
    this.pending++;
  }

  cancel(id: string): boolean {
    for (const lvl of this.levels) {
      if (lvl.removeById(id)) {
        this.pending--;
        return true;
      }
    }
    return false;
  }

  tick(): FiredTimer[] {
    return this.advance(this.clock.now() + this.tickMs);
  }

  advance(toTime: number): FiredTimer[] {
    if (toTime < this.clock.now()) throw new InvalidAdvanceError();
    const fired: Timer[] = [];
    this.collectExpired(fired);
    while (this.clock.now() < toTime) {
      const step = Math.min(this.tickMs, toTime - this.clock.now());
      this.clock.advance(step);
      if (step === this.tickMs) {
        this.stepWheel(fired);
      } else {
        this.collectExpired(fired);
      }
    }
    fired.sort((a, b) => a.deadline - b.deadline || a.seq - b.seq);
    return fired.map((t) => ({ id: t.id, payload: t.payload, deadline: t.deadline }));
  }

  /**
   * Process one level-0 tick at the current clock time: cascade higher
   * levels whose window boundary was crossed (coarse to fine), then drain
   * level 0's current slot.
   */
  private stepWheel(fired: Timer[]): void {
    const now = this.clock.now();
    for (let i = this.levels.length - 1; i >= 1; i--) {
      const lvl = this.levels[i];
      if (now % lvl.slotMs === 0) {
        cascadeDown(lvl.advanceOne(now), this.levels, i, now, this.tickMs);
      }
    }
    const due = this.levels[0].advanceOne(now);
    for (const t of due) {
      if (t.deadline <= now) {
        fired.push(t);
        this.pending--;
      } else {
        placeTimer(t, this.levels, now);
      }
    }
  }

  /** Sweep out any timers whose deadline is already reached. */
  private collectExpired(fired: Timer[]): void {
    const now = this.clock.now();
    for (const lvl of this.levels) {
      for (const t of lvl.takeExpired(now)) {
        fired.push(t);
        this.pending--;
      }
    }
  }
}
