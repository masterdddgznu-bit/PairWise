export type OmMessage = {
  kind: "OM";
  depth: number;
  path: number[];
  value: string;
  from: number;
  msgId: string;
};
export type Message = OmMessage;
export const DEFAULT_ORDER = "retreat";
