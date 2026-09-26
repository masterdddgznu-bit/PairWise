import { CasFailedError } from "./errors.js";
import type { RevStore } from "./store.js";

/**
 * Compare-and-swap: write only when the key's current revision equals
 * `expectedRevision`. A successful CAS behaves like a put.
 */
export function applyCas(
  store: RevStore,
  key: string,
  expectedRevision: number,
  value: string,
): number {
  const current = store.data.get(key);
  if (!current || current.revision !== expectedRevision) {
    throw new CasFailedError();
  }
  store.ttl.clear(key);
  const revision = store.revisions.next();
  store.data.set(key, { value, revision });
  store.historyLog.append(key, revision, value);
  store.watches.notify({ type: "put", key, value, revision });
  return revision;
}
