export type Vector = number[];
export type CbMessage = {
  msgId: string;
  from: number;
  payload: string;
  vt: Vector;
};
export type Delivered = { msgId: string; from: number; payload: string };
