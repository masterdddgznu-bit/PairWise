import type { VirtualClock } from "./clock.js";
import type { LeaseInfo } from "./types.js";

/** Lease state machine — starter stub. */
export class LeaseManager {
  constructor(_clock: VirtualClock) {}

  acquire(_holderId: string, _ttlMs: number): { fence: number } {
    throw new Error("acquire not implemented");
  }

  renew(_holderId: string, _fence: number, _ttlMs: number): void {
    throw new Error("renew not implemented");
  }

  release(_holderId: string, _fence: number): void {
    throw new Error("release not implemented");
  }

  current(): LeaseInfo | null {
    return null;
  }

  assertFence(_fence: number): void {
    throw new Error("assertFence not implemented");
  }
}
