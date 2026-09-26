export type VersionedValue = {
  value: string;
  revision: number;
};

export type WatchEvent = {
  type: "set" | "delete";
  key: string;
  value: string | null;
  revision: number;
};

export type SchemaKind = "string" | "number" | "bool";

export type TxnOp =
  | { type: "set"; key: string; value: string }
  | { type: "delete"; key: string }
  | { type: "setOn"; layer: string; key: string; value: string }
  | { type: "deleteOn"; layer: string; key: string };

/** Per-layer entry: null value means tombstone. */
export type LayerEntry = {
  value: string | null;
  revision: number;
};
