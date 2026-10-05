export { VirtualClock } from "./clock.js";
export { HoleBuf } from "./holebuf.js";
export type {
  HoleBufOptions,
  PushResult,
  TakeEntry,
  SkipResult,
  DriveResult,
} from "./holebuf.js";
export {
  HoleBufError,
  InvalidConfigError,
  InvalidPushError,
  UnknownStreamError,
} from "./errors.js";
