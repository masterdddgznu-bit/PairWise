export const MessageKind = {
  FLOOD: "FLOOD",
} as const;

export type Message = {
  kind: typeof MessageKind.FLOOD;
  value: number;
  from: number;
  msgId: string;
};
