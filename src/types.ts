export type TxStatus = "active" | "committed" | "aborted";

export type VersionEntry = {
  value: string | null;
  commitTs: number;
  txId: string;
};

export type TxRecord = {
  id: string;
  snapTs: number;
  readSet: Set<string>;
  writes: Map<string, string | null>;
  status: TxStatus;
  commitTs?: number;
};

export type CommitResult =
  | { ok: true; commitTs: number }
  | { ok: false; reason: string };

export type MvccSsiOptions = {
  ssi?: boolean;
};

export type MvccSnapshot = {
  lastCommittedTs: number;
  versions: Record<string, VersionEntry[]>;
  txns: TxRecord[];
  journal: Array<{ key: string; entry: VersionEntry }>;
  ssi: boolean;
};
