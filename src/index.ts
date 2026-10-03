export { VirtualClock } from "./clock.js";
export { CausBuf } from "./causbuf.js";
export { GapBuffer } from "./buffer.js";
export { canDeliver, applyDeliver } from "./deliver.js";
export { zero, copy, bumpSelf } from "./vclock.js";
export {
  CausBufError,
  InvalidConfigError,
  InvalidMessageError,
  InvalidStateError,
} from "./errors.js";
export type {
  CausBufOptions,
  VectorClock,
  Message,
  ReceiveResult,
} from "./types.js";
