import type { LeaseManager } from "./lease.js";

export function requireValidFence(_lease: LeaseManager, _fence: number): void {
  throw new Error("requireValidFence not implemented");
}
