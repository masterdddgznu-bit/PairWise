import { VirtualClock } from "./clock.js";
import type { Delivered } from "./types.js";
import { WindowSlots } from "./window.js";
import { GapTracker } from "./gap_tracker.js";
import { deliverContiguous } from "./deliver.js";
import {
  InvalidSeqError,
  OutOfWindowError,
  DuplicateSeqError,
} from "./errors.js";

export type SeqBufOptions = {
  clock: VirtualClock;
  windowSize?: number;
  gapTimeout?: number;
  startExpect?: number;
};

/** In-process reorder / sequence buffer over a sliding window. */
export class SeqBuf {
  readonly clock: VirtualClock;
  private readonly windowSize: number;
  private readonly gapTimeout: number;
  private readonly slots: WindowSlots;
  private readonly gap = new GapTracker();
  private readonly skippedSeqs: number[] = [];
  private expectSeq: number;

  constructor(opts: SeqBufOptions) {
    this.clock = opts.clock;
    this.windowSize = opts.windowSize ?? 8;
    this.gapTimeout = opts.gapTimeout ?? 10;
    this.expectSeq = opts.startExpect ?? 0;
    this.slots = new WindowSlots(this.windowSize, this.expectSeq);
  }

  expect(): number {
    return this.expectSeq;
  }

  push(seq: number, payload: string): Delivered[] {
    if (seq < 0) throw new InvalidSeqError(seq);
    if (seq < this.expectSeq) return [];
    if (seq >= this.expectSeq + this.windowSize) {
      throw new OutOfWindowError(seq);
    }
    if (this.slots.has(seq)) throw new DuplicateSeqError(seq);
    this.slots.put({ seq, payload });
    this.refreshGap();
    return this.drain();
  }

  tick(): Delivered[] {
    this.clock.advance(1);
    const delivered = this.reclaimGaps();
    return delivered.concat(this.deliverAll());
  }

  reclaimGaps(): Delivered[] {
    const now = this.clock.now();
    if (
      !this.slots.has(this.expectSeq) &&
      this.slots.maxBufferedSeq() !== null &&
      this.gap.timedOut(now, this.gapTimeout)
    ) {
      this.skippedSeqs.push(this.expectSeq);
      this.expectSeq += 1;
      this.slots.setBase(this.expectSeq);
      this.gap.clear();
      this.refreshGap();
    }
    return this.drain();
  }

  deliverAll(): Delivered[] {
    return this.drain();
  }

  bufferedCount(): number {
    return this.slots.count();
  }

  skipped(): number[] {
    return [...this.skippedSeqs];
  }

  private drain(): Delivered[] {
    const { delivered, newExpect } = deliverContiguous(this.slots, this.expectSeq);
    if (newExpect !== this.expectSeq) {
      this.expectSeq = newExpect;
      this.slots.setBase(newExpect);
      this.gap.clear();
    }
    this.refreshGap();
    return delivered;
  }

  private refreshGap(): void {
    const max = this.slots.maxBufferedSeq();
    if (!this.slots.has(this.expectSeq) && max !== null && max > this.expectSeq) {
      this.gap.mark(this.clock.now());
    } else {
      this.gap.clear();
    }
  }
}
