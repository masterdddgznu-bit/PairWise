export { VirtualClock } from "./clock.js";
export {
  HlcGate,
  happensBefore,
  type HlcStamp,
  type HlcGateOptions,
  type MessageStatus,
  type TimeoutPolicy,
} from "./gate.js";
export {
  HlcGateError,
  InvalidConfigError,
  InvalidNodeError,
  InvalidMessageError,
  UnknownMessageError,
} from "./errors.js";
