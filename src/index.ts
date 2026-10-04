export { VirtualClock } from "./clock.js";
export {
  EpochGateError,
  InvalidConfigError,
  SealingError,
  UnknownTicketError,
  FenceError,
  InvalidEpochError,
} from "./errors.js";
export { EpochGate } from "./epochgate.js";
export type {
  CurrentInfo,
  DriveReport,
  EpochGateOptions,
  EpochResult,
  EpochState,
  SubmitResult,
  TicketState,
} from "./epochgate.js";
