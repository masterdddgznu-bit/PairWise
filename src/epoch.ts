import type { ThreadTable } from "./thread_table.js";

/** Global epoch tracker. */
export class EpochTracker {
  private g = 0;

  current(): number {
    return this.g;
  }

  bump(): number {
    this.g += 1;
    return this.g;
  }

  minPinned(threads: ThreadTable): number | null {
    const epochs = threads.pinnedEpochs();
    if (epochs.length === 0) {
      return null;
    }
    return Math.min(...epochs);
  }
}
