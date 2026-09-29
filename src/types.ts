export type MsgKind = "ELECTION" | "LEADER";
export type Message = {
  kind: MsgKind;
  uid: number;
  from: number;
  msgId: string;
};
