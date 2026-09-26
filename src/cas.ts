import type { RevStore } from "./store.js";

/** CAS feature — not implemented on starter. */
export function applyCas(
  _store: RevStore,
  _key: string,
  _expectedRevision: number,
  _value: string,
): number {
  throw new Error("cas not implemented");
}
