export type WalOp = "put" | "delete";

export type WalRecord = {
  lsn: number;
  op: WalOp;
  key: string;
  value?: string;
  at: number;
};

export type CheckpointMeta = {
  lsn: number;
  at: number;
  keys: number;
};

export type CheckpointSnapshot = CheckpointMeta & {
  data: Map<string, string>;
};

export type DurabilityInfo = {
  walLen: number;
  checkpointLsn: number | null;
};
