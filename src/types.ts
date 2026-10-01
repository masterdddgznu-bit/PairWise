export type TxnStatus = "active" | "prepared" | "committed" | "aborted";

export type KeyVersion = {
  value: string;
  version: number;
};

export type TxnRecord = {
  txnId: string;
  status: TxnStatus;
  writes: Record<string, string>;
  expectedVersions: Record<string, number>;
  prepareStartedAt: number | null;
  preparedShards: number[];
};

export type JournalEntry =
  | { kind: "prepare"; txnId: string; shardId: number; at: number }
  | { kind: "commit"; txnId: string; at: number }
  | { kind: "abort"; txnId: string; at: number };

export type ShardSnapshot = Record<string, KeyVersion>;

export type ShardTxnSnapshot = {
  shards: ShardSnapshot[];
  txns: TxnRecord[];
  journal: JournalEntry[];
  nextTxnNum: number;
};
