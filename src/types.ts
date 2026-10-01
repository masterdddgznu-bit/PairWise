export type Bit = 0 | 1;
export type ProposeVal = Bit | "?";
export type Message =
  | { kind: "R"; round: number; from: number; value: Bit; msgId: string }
  | { kind: "P"; round: number; from: number; value: ProposeVal; msgId: string };
