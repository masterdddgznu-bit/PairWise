import { VirtualClock } from "./clock.js";

export type EpochGcOptions = {
  clock: VirtualClock;
  threadCount?: number;
  reclaimDelay?: number;
};

/** Epoch-based reclaimer — stub. */
export class EpochGc {
  readonly clock: VirtualClock;

  constructor(opts: EpochGcOptions) {
    this.clock = opts.clock;
  }

  pin(_threadId: number): number {
    return 0;
  }

  unpin(_threadId: number): boolean {
    return false;
  }

  currentEpoch(): number {
    return 0;
  }

  minPinned(): number | null {
    return null;
  }

  bump(): number {
    return 0;
  }

  retire(_id: string): void {
    /* stub */
  }

  reclaim(): string[] {
    return [];
  }

  tick(): string[] {
    return [];
  }

  unregister(_threadId: number): void {
    /* stub */
  }

  pendingCount(): number {
    return 0;
  }
}
