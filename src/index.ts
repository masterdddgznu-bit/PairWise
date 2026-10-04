export { VirtualClock } from "./clock.js";
export {
  CredMuxError,
  InvalidConfigError,
  UnknownStreamError,
  StreamClosedError,
  FenceError,
  StreamLimitError,
  InvalidRequestError,
} from "./errors.js";
export { CredMux } from "./credmux.js";
export type { CredMuxOptions, SendResult, Delivery } from "./credmux.js";
