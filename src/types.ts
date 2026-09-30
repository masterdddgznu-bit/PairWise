export type Message = {
  kind: "PULSE";
  pulse: number;
  from: number;
  msgId: string;
};
