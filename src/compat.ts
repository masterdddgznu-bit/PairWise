import type { LockMode } from "./types.js";

/** Starter stubs — feature must implement real matrix. */
export function compatible(_held: LockMode, _requested: LockMode): boolean {
  return false;
}

export function covers(_held: LockMode, _needed: LockMode): boolean {
  return false;
}

export function canUpgrade(_from: LockMode, _to: LockMode): boolean {
  return false;
}

export function intentionFor(leaf: LockMode): "IS" | "IX" {
  return leaf === "S" || leaf === "IS" ? "IS" : "IX";
}
