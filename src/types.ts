export type SmMessage = {
  kind: "SM";
  value: string;
  signers: number[];
  proof: string[];
  from: number;
  msgId: string;
};
export type Message = SmMessage;
export const DEFAULT_ORDER = "retreat";
