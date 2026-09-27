export type Entry = {
  key: string;
  expireAt: number;
  seq: number;
};

export type RememberResult = {
  inserted: boolean;
  refreshed: boolean;
  evicted: string | null;
};
