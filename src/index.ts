export { VirtualClock } from "./clock.js";
export { SpanOwn } from "./spanown.js";
export type {
  AcquireOptions,
  AcquireResult,
  DriveResult,
  HoldInfo,
  SpanOwnOptions,
} from "./spanown.js";
export {
  FenceError,
  InvalidAcquireError,
  InvalidConfigError,
  SpanOwnError,
  UnknownTicketError,
} from "./errors.js";
