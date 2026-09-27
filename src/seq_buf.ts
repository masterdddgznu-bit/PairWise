import { VirtualClock } from "./clock.js";
import type { Delivered } from "./types.js";

export type SeqBufOptions = {
  clock: VirtualClock;
  windowSize?: number;
  gapTimeout?: number;
  startExpect?: number;
};

/** Reorder buffer — stub. */
export class SeqBuf {
  readonly clock: VirtualClock;

  constructor(opts: SeqBufOptions) {
    this.clock = opts.clock;
  }

  expect(): number {
    return 0;
  }

  push(_seq: number, _payload: string): Delivered[] {
    return [];
  }

  tick(): Delivered[] {
    return [];
  }

  reclaimGaps(): Delivered[] {
    return [];
  }

  deliverAll(): Delivered[] {
    return [];
  }

  bufferedCount(): number {
    return 0;
  }

  skipped(): number[] {
    return [];
  }
}
