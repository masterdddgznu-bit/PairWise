export type CacheRecord = {
  tenant: string;
  key: string;
  value: unknown;
  generation: number;
  expiresAt: number;
};

export type CacheSnapshot = {
  records: CacheRecord[];
  generations: Array<{ tenant: string; key: string; generation: number }>;
};

export type CacheGetResult<V = unknown> = {
  value: V;
  generation: number;
};

export type CacheStats = {
  inflight: number;
};
