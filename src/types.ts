export type Bit = 0 | 1;
export type Message =
  | { kind: "PROPOSE"; phase: number; from: number; value: Bit; msgId: string }
  | { kind: "KING"; phase: number; from: number; value: Bit; msgId: string };
