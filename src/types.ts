export type Message =
  | { kind: "DOWN"; cand: number; from: number; msgId: string }
  | { kind: "UP"; keep: boolean; from: number; msgId: string };
