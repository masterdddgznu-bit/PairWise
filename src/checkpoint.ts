import type { CheckpointPayload, AggregateResult } from "./types.js";
import type { KeyedWindowState } from "./keyed_state.js";
import type { SideOutput } from "./side_output.js";

export function serializeCheckpoint(opts: {
  keyed: KeyedWindowState;
  late: SideOutput;
  emitted: AggregateResult[];
  nextOffset: number;
}): string {
  const payload: CheckpointPayload = {
    maxEventTime: 0,
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
