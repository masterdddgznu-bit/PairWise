export type Message = {
  kind: "PULSE";
  d: number;
  from: number;
  msgId: string;
};
