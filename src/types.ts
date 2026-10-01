export type Message =
  | { kind: "UP"; pulse: number; from: number; msgId: string }
  | { kind: "DOWN"; pulse: number; from: number; msgId: string }
  | { kind: "PULSE"; pulse: number; from: number; msgId: string };
