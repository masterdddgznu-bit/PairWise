export { VirtualClock } from "./clock.js";
export { DedupTtl } from "./dedup_ttl.js";
export type { DedupTtlOptions } from "./dedup_ttl.js";
export { EntryStore } from "./entry_store.js";
export { sortByExpiry, dueEntries } from "./expiry_index.js";
export { pickVictim } from "./evict.js";
export {
  DedupTtlError,
  InvalidKeyError,
  InvalidConfigError,
} from "./errors.js";
export type { Entry, RememberResult } from "./types.js";
