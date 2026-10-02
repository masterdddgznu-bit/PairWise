export type KVEntry = { value: string; version: number };

export type QuorumKVOptions = {
  n: number;
  r: number;
  w: number;
};

export type QuorumSnapshot = {
  n: number;
  r: number;
  w: number;
  replicas: Record<string, KVEntry>[];
  down: number[];
};
