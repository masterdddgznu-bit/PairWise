export { expectedBackoffMs } from "../src/backoff.js";
export { FakeClock } from "../src/clock.js";
export { EffectLog } from "../src/effect_log.js";
import { Orchestrator } from "../src/orchestrator.js";
import { FakeClock } from "../src/clock.js";

export function makeOrch(maxWorkers = 2) {
  const clock = new FakeClock();
  const orch = new Orchestrator({ maxWorkers, clock });
  return { clock, orch };
}
