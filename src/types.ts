export type Message =
  | { kind: "BASIC"; from: number; vc: number[]; msgId: string }
  | { kind: "PROBE"; sum: number; black: boolean; from: number; msgId: string };
