export { VirtualClock } from "./clock.js";
export { AbdReg } from "./abdreg.js";
export type { AbdRegOptions } from "./abdreg.js";
export { Replica } from "./replica.js";
export { Op } from "./op.js";
export { majorityOf, hasQuorum } from "./quorum.js";
export { cmpTs, maxTs } from "./timestamp.js";
export {
  AbdRegError,
  InvalidValueError,
  InvalidReplicaError,
  NotDoneError,
} from "./errors.js";
export type {
  Timestamp,
  ReplicaStore,
  OpKind,
  OpStatus,
  OpPhase,
} from "./types.js";
