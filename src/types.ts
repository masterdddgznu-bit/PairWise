export type LeaseRecord = {
  tenant: string;
  resource: string;
  token: number;
  expiry: number;
};

export type HolderView = {
  tenant: string;
  token: number;
  expiry: number;
} | null;

export type AcquireResult = {
  token: number;
  expiry: number;
};

export type PoolSnapshot = {
  leases: LeaseRecord[];
  nextToken: Record<string, number>;
  inflight: string[];
};
