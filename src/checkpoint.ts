import type { CheckpointPayload, AggregateResult } from "./types.js";
import type { KeyedWindowState } from "./keyed_state.js";
import type { SideOutput } from "./side_output.js";
import type { WatermarkTracker } from "./watermark.js";

export function serializeCheckpoint(opts: {
  keyed: KeyedWindowState;
  late: SideOutput;
  watermark: WatermarkTracker;
  emitted: AggregateResult[];
  nextOffset: number;
}): string {
  const payload: CheckpointPayload = {
    maxEventTime: opts.watermark.maxObserved(),
    keyed: opts.keyed.toRecord(),
    late: opts.late.all(),
    emitted: opts.emitted.map((r) => ({ ...r })),
    nextOffset: opts.nextOffset,
  };
  return JSON.stringify(payload);
}

export function parseCheckpoint(raw: string): CheckpointPayload {
  return JSON.parse(raw) as CheckpointPayload;
}
