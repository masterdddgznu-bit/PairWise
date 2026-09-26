export type VersionedValue = {
  value: string;
  revision: number;
};

export type HistoryRecord = {
  revision: number;
  value: string | null;
};

export type WatchEvent = {
  type: "put" | "delete";
  key: string;
  value: string | null;
  revision: number;
};

export type TxnOp =
  | { type: "put"; key: string; value: string }
  | { type: "delete"; key: string }
  | { type: "cas"; key: string; expectedRevision: number; value: string };
