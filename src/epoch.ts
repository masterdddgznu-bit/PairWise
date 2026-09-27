import type { ThreadTable } from "./thread_table.js";

/** Global epoch — stub. */
export class EpochTracker {
  private g = 0;

  current(): number {
    return this.g;
  }

  bump(): number {
    return this.g;
  }

  minPinned(_threads: ThreadTable): number | null {
    return null;
  }
}
