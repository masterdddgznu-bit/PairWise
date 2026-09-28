import type { LeaseManager } from "./lease.js";
import { StaleFenceError } from "./errors.js";

export function requireValidFence(lease: LeaseManager, fence: number | undefined): void {
  if (fence === undefined) {
    throw new StaleFenceError("fence is required");
  }
  lease.assertFence(fence);
}
