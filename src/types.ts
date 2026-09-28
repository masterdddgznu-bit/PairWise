export type MsgKind = "REQUEST" | "TOKEN";
export type Message =
  | { kind: "REQUEST"; from: number; seq: number; msgId: string }
  | { kind: "TOKEN"; from: number; ln: number[]; queue: number[]; msgId: string };
export type ProcState = "idle" | "waiting" | "held";
