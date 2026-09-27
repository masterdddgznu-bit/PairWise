export type CacheEventType = "set" | "delete" | "expire" | "evict";

export type CacheEvent = {
  seq: number;
  type: CacheEventType;
  key: string;
  at: number;
};

export type SetOpts = { ttlMs?: number };

export type BackendStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
};

export type Entry = {
  value: string;
  expireAt: number | null;
};
