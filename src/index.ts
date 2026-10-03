export { GranLock } from "./granlock.js";
export { ResourceTree } from "./tree.js";
export { compatible, covers, intentionFor } from "./compat.js";
export { WaitForGraph } from "./waits.js";
export { WaitQueues } from "./queue.js";
export {
  GranLockError,
  InvalidConfigError,
  InvalidIdError,
  DeadlockError,
} from "./errors.js";
export type { LockMode, ResourceSpec, GranLockOptions } from "./types.js";
