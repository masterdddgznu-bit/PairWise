import type { Timer } from "./types.js";
import type { WheelLevel } from "./wheel_level.js";
/**
 * Re-insert timers into lower levels: each timer lands in the lowest
 * level (below fromLevel) whose current window covers its deadline.
 */
export function cascadeDown(
  timers: Timer[],
  levels: WheelLevel[],
  fromLevel: number,
): void {
  for (const timer of timers) {
    for (let i = 0; i < fromLevel; i++) {
      if (levels[i].accepts(timer.deadline)) {
        levels[i].add(timer);
        break;
      }
    }
  }
}
