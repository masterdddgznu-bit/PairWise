import type { LockMode } from "./types.js";

export function compatible(_held: LockMode, _req: LockMode): boolean {
  return false;
}

export function covers(_held: LockMode, _need: LockMode): boolean {
  return false;
}

export function intentionFor(_mode: LockMode): LockMode {
  return "IS";
}
