import { VirtualClock } from "./clock.js";
import type { StreamRecord, AggregateResult } from "./types.js";
import { WatermarkTracker } from "./watermark.js";
import { KeyedWindowState } from "./keyed_state.js";
import { SideOutput } from "./side_output.js";
import { WindowAggregateOperator } from "./operator.js";
import { serializeCheckpoint, parseCheckpoint } from "./checkpoint.js";

export class StreamJob {
  private watermark: WatermarkTracker;
  private state = new KeyedWindowState();
  private lateSide = new SideOutput();
  private operator: WindowAggregateOperator;
  private emitted: AggregateResult[] = [];
  private nextOffset = 0;

  constructor(
    private readonly opts: {
      clock: VirtualClock;
      windowSize: number;
      allowedLateness: number;
    },
  ) {
    this.watermark = new WatermarkTracker(opts.clock, opts.allowedLateness);
    this.operator = new WindowAggregateOperator(
      opts.windowSize,
      this.state,
      this.lateSide,
      this.watermark,
    );
  }

  ingest(records: StreamRecord[]): number[] {
    const offsets: number[] = [];
    for (const r of records) {
      offsets.push(this.nextOffset++);
      this.operator.process(r);
    }
    return offsets;
  }

  tick(): void {
    const fresh = this.operator.closeEligible();
    for (const r of fresh) {
      this.emitted.push(r);
    }
  }

  results(): AggregateResult[] {
    return this.emitted
      .map((r) => ({ ...r }))
      .sort((a, b) => a.key.localeCompare(b.key) || a.windowStart - b.windowStart);
  }

  late(): StreamRecord[] {
    return this.lateSide.all();
  }

  checkpoint(): string {
    return serializeCheckpoint({
      maxEventTime: this.watermark.maxObserved(),
      keyed: this.state,
      late: this.lateSide,
      emitted: this.emitted,
      nextOffset: this.nextOffset,
    });
  }

  restore(raw: string): void {
    const cp = parseCheckpoint(raw);
    this.state.restore(cp.keyed);
    this.lateSide.restore(cp.late);
    this.emitted = cp.emitted.map((r) => ({ ...r }));
    this.nextOffset = cp.nextOffset;
    this.watermark.restore(cp.maxEventTime);
    this.operator = new WindowAggregateOperator(
      this.opts.windowSize,
      this.state,
      this.lateSide,
      this.watermark,
    );
  }

  ingestFrom(records: StreamRecord[], startOffset: number): void {
    for (let i = 0; i < records.length; i++) {
      if (i > startOffset) {
        this.operator.process(records[i]!);
        this.nextOffset++;
      }
    }
  }
}
