import type { LockMode } from "./types.js";

export function compatible(held: LockMode, requested: LockMode): boolean {
  return held === "S" && requested === "S";
}

export function covers(held: LockMode, requested: LockMode): boolean {
  if (held === "X") return true;
  return held === requested;
}
