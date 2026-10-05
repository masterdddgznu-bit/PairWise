export { VirtualClock } from "./clock.js";
export { LeaseBank } from "./lease-bank.js";
export type {
  AcquireResult,
  DriveResult,
  LeaseBankConfig,
} from "./lease-bank.js";
export {
  LeaseBankError,
  InvalidConfigError,
  InvalidArgError,
  InvalidSlotError,
  DuplicateError,
  FenceError,
  UnknownTicketError,
  CapacityError,
} from "./errors.js";
