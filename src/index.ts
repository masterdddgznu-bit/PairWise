export { VirtualClock } from "./clock.js";
export { FencePool } from "./pool.js";
export type {
  LeaseRecord,
  HolderView,
  AcquireResult,
  PoolSnapshot,
} from "./types.js";
export {
  FenceError,
  LeaseHeldError,
  StaleTokenError,
  InflightError,
} from "./errors.js";
