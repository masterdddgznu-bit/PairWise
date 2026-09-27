export type Lease = {
  pool: string;
  resourceId: string;
  holderId: string;
  token: number;
  expireAt: number | null;
};

export type AcquireOpts = {
  ttlMs?: number;
};

export type LeaseEventType =
  | "acquire"
  | "release"
  | "expire"
  | "renew"
  | "steal";

export type LeaseEvent = {
  seq: number;
  type: LeaseEventType;
  pool: string;
  resourceId: string;
  holderId: string;
  at: number;
};

export type ResourceState = {
  resourceId: string;
  holderId: string | null;
  token: number;
  expireAt: number | null;
};
