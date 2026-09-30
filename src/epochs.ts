import type { VirtualClock } from "./clock.js";
import type { WaitStatus } from "./types.js";

/** Wait deadline registry — starter stub. */
export class WaitRegistry {
  constructor(_clock: VirtualClock) {}

  register(_epoch: number, _deadlineMs: number): void {
    throw new Error("register not implemented");
  }

  status(_epoch: number, _allReady: boolean): WaitStatus {
    throw new Error("status not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }
}
