export type MsgKind = "REQUEST" | "REPLY" | "RELEASE";
export type Message = {
  kind: MsgKind;
  from: number;
  ts: number;
  msgId: string;
};
export type ProcState = "idle" | "waiting" | "held";
export type WaitItem = { from: number; ts: number };
