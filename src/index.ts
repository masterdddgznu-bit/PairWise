export { VirtualClock } from "./clock.js";
export {
  DedupeQ,
  type DedupeQConfig,
  type DriveResult,
  type EnqueueResult,
} from "./dedupeq.js";
export {
  CapacityError,
  DedupeQError,
  DuplicateRecentError,
  InvalidConfigError,
  InvalidIdError,
  PoisonedError,
} from "./errors.js";
export type { QueueEntry } from "./queue.js";
