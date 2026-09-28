export type TxStatus = "active" | "committed" | "aborted";

export type Version = {
  value: string | null;
  commitTs: number;
  txId: string;
};
