import type { LeaseManager } from "./lease.js";

export function requireValidFence(
  lease: LeaseManager,
  fence: number | undefined,
): void {
  lease.assertFence(fence);
}
