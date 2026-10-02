export type TxStatus = "active" | "committed" | "aborted";

export type VersionEntry = {
  value: string | null;
  commitTs: number;
  txId: string;
};

export type TxRecord = {
  id: string;
  startTs: number;
  readSet: Set<string>;
  writes: Map<string, string | null>;
  status: TxStatus;
  commitTs?: number;
};

export type CommitResult =
  | { ok: true; commitTs: number }
  | { ok: false; reason: "ww" | "rs" };

export type OccOptions = {
  validateReads?: boolean;
};

export type OccSnapshot = {
  lastCommittedTs: number;
  versions: Record<string, VersionEntry[]>;
  txns: TxRecord[];
  journal: Array<{ key: string; entry: VersionEntry }>;
  validateReads: boolean;
};
