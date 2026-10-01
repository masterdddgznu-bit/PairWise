export type EchoMessage = {
  kind: "ECHO";
  round: number;
  from: number;
  value: string;
  signers: number[];
  proof: string[];
  msgId: string;
};
export type Message = EchoMessage;
