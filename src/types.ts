export type StreamEvent = {
  id: string;
  key: string;
  value: number;
  eventTime: number;
};

export type Agg = {
  key: string;
  sum: number;
  count: number;
};

export type SessionAgg = {
  key: string;
  start: number;
  end: number;
  sum: number;
  count: number;
};

export type EmitResult = "ok" | "late" | "duplicate";

export type LateWinOpts = {
  allowedLateness?: number;
};
