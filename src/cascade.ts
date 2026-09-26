import type { Timer } from "./types.js";
import type { WheelLevel } from "./wheel_level.js";
/** Re-insert timers into lower levels — stub no-op. */
export function cascadeDown(
  _timers: Timer[],
  _levels: WheelLevel[],
  _fromLevel: number,
  _now: number,
  _tickMs: number,
): void { /* stub */ }
