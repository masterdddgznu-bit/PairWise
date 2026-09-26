import type { Timer } from "./types.js";
import type { WheelLevel } from "./wheel_level.js";

/**
 * Place a timer into the lowest level (0..maxLevel) whose remaining range
 * can represent it. Timers already due land in level 0's current slot.
 * Returns the level index used.
 */
export function placeTimer(
  timer: Timer,
  levels: WheelLevel[],
  now: number,
  maxLevel: number = levels.length - 1,
): number {
  for (let i = 0; i <= maxLevel; i++) {
    const lvl = levels[i];
    const windowStart = lvl.windowStart(now);
    if (timer.deadline < windowStart + lvl.slotMs) {
      // Falls inside level i's current window: only reachable at level 0,
      // where it means the timer is due now (or overdue).
      levels[0].add(timer);
      return 0;
    }
    if (i === maxLevel || timer.deadline < windowStart + lvl.slotMs * lvl.slotCount) {
      lvl.add(timer);
      return i;
    }
  }
  return -1;
}

/** Re-insert timers drained from level `fromLevel` into the levels below it. */
export function cascadeDown(
  timers: Timer[],
  levels: WheelLevel[],
  fromLevel: number,
  now: number,
  _tickMs: number,
): void {
  for (const timer of timers) {
    placeTimer(timer, levels, now, fromLevel - 1);
  }
}
