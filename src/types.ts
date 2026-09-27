export type TxStatus =
  | "open"
  | "preparing"
  | "prepared"
  | "committed"
  | "aborted";

export type Vote = "yes" | "no";

export type JournalEntry =
  | { type: "begin"; txId: string }
  | { type: "prepared"; txId: string; participants: number[] }
  | { type: "commit"; txId: string }
  | { type: "abort"; txId: string };

export type WriteOp = {
  participantId: number;
  key: string;
  value: string;
};
