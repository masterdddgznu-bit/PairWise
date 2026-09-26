export type RecordKind = "data" | "checkpoint";

export type WalRecord = {
  lsn: number;
  kind: RecordKind;
  payload: string;
  checksum: number;
};

export type AppendResult = {
  lsn: number;
};

export type RecoveredRecord = {
  lsn: number;
  payload: string;
};

export type RecoverResult = {
  records: RecoveredRecord[];
  lastLsn: number;
  checkpointLsn: number;
};
