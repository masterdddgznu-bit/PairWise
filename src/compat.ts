import type { LockMode } from "./types.js";

/** BUG: S conflicts with S (should be compatible). */
export function compatible(held: LockMode, requested: LockMode): boolean {
  if (held === "S" && requested === "S") return false;
  if (held === "X" || requested === "X") return false;
  return true;
}

export function covers(held: LockMode, requested: LockMode): boolean {
  if (held === "X") return true;
  return held === requested;
}
