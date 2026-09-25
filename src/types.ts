export type StreamRecord = {
  key: string;
  value: number;
  eventTime: number;
};

export type WindowId = {
  key: string;
  windowStart: number;
};

export type AggregateResult = {
  key: string;
  windowStart: number;
  windowEnd: number;
  sum: number;
};

export type WindowAccumulator = {
  windowStart: number;
  windowEnd: number;
  sum: number;
  closed: boolean;
};

export type CheckpointPayload = {
  maxEventTime: number;
  keyed: Record<string, Record<string, WindowAccumulator>>;
  late: StreamRecord[];
  emitted: AggregateResult[];
  nextOffset: number;
};
