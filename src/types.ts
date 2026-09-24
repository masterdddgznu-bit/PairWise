export type ShardId = number;
export type TxnId = string;
export type Key = string;
export type Value = string;

/** Monotonic logical time used as commit/prepare stamps. */
export type LogicalTime = number;

export type VersionedValue = {
  value: Value | null; // null means tombstone delete
  commitTs: LogicalTime;
};

export type PrepareRecord = {
  txnId: TxnId;
  /** keys this participant intends to write (put/del) */
  writes: Array<{ key: Key; value: Value | null }>;
  /** snapshot time captured at begin */
  readTs: LogicalTime;
  preparedAt: LogicalTime;
};

export type TxnState = "open" | "prepared" | "committed" | "aborted";
