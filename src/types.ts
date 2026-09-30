export type Message = {
  kind: "FLOOD";
  value: number;
  from: number;
  msgId: string;
};
