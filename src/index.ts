export { VirtualClock } from "./clock.js";
export { SpanLease } from "./span-lease.js";
export type {
  AcquireResult,
  DriveResult,
  SpanLeaseOptions,
} from "./span-lease.js";
export {
  CapacityError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
  InvalidRangeError,
  SpanLeaseError,
  UnknownTicketError,
} from "./errors.js";
