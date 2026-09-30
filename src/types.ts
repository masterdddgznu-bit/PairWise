export type Message =
  | { kind: "PULSE"; value: number; from: number; msgId: string }
  | { kind: "DONE"; value: number; from: number; msgId: string };
