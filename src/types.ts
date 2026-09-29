export type Dir = "L" | "R";
export type MsgKind = "PROBE" | "REPLY" | "LEADER";
export type Message =
  | { kind: "PROBE"; uid: number; phase: number; hop: number; dir: Dir; from: number; msgId: string }
  | { kind: "REPLY"; uid: number; phase: number; dir: Dir; from: number; msgId: string }
  | { kind: "LEADER"; uid: number; dir: Dir; from: number; msgId: string };
