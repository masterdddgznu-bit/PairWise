import { CasFailedError } from "./errors.js";
import type { RevStore } from "./store.js";

/**
 * Compare-and-swap: write `value` only when the key's current revision
 * equals `expectedRevision` (missing keys have revision 0). A successful
 * CAS behaves like a put: clears TTL, appends history, notifies watches.
 */
export function applyCas(
  store: RevStore,
  key: string,
  expectedRevision: number,
  value: string,
): number {
  const current = store.get(key);
  const currentRevision = current ? current.revision : 0;
  if (currentRevision !== expectedRevision) {
    throw new CasFailedError(
      `cas on "${key}" failed: expected revision ${expectedRevision}, current ${currentRevision}`,
    );
  }
  return store.put(key, value);
}
