import type { StreamRecord, AggregateResult } from "./types.js";
import type { KeyedWindowState } from "./keyed_state.js";
import type { SideOutput } from "./side_output.js";
import type { WatermarkTracker } from "./watermark.js";
import { WindowAssigner } from "./window_assigner.js";

/** Windowed sum operator — routes on-time vs late events. */
export class WindowAggregateOperator {
  private assigner: WindowAssigner;

  constructor(
    private readonly windowSize: number,
    private readonly state: KeyedWindowState,
    private readonly late: SideOutput,
    private readonly watermark: WatermarkTracker,
  ) {
    this.assigner = new WindowAssigner(windowSize);
  }

  process(record: StreamRecord): void {
    this.watermark.observe(record.eventTime);
    const { windowStart, windowEnd } = this.assigner.assign(record.eventTime);

    if (this.state.isClosed(record.key, windowStart)) {
      this.late.emit(record);
      return;
    }

    this.state.add(record.key, windowStart, windowEnd, record.value);
  }

  closeEligible(): AggregateResult[] {
    const wm = this.watermark.watermark();
    const closed = this.state.closeWhereEndAtMost(wm);
    return closed.map(({ key, window: w }) => ({
      key,
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
      sum: w.sum,
    }));
  }
}
