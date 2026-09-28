export type MsgKind = "REQUEST" | "TOKEN";
export type Message =
  | { kind: "REQUEST"; from: number; msgId: string }
  | { kind: "TOKEN"; from: number; msgId: string };
export type ProcState = "idle" | "waiting" | "held";
