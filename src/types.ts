export type WindowMode = "tumbling" | "session";

export type SessWinOptions = {
  clock: import("./clock.js").VirtualClock;
  mode: WindowMode;
  sizeMs?: number;
  gapMs?: number;
  allowedLatenessMs?: number;
};

export type WindowOut = {
  key: string;
  start: number;
  end: number;
  sum: number;
};

export type LateEvent = {
  key: string;
  eventTime: number;
  value: number;
};
