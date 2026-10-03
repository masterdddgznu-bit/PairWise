export type LeaseWheelOptions = {
  clock: import("./clock.js").VirtualClock;
  slotCount: number;
  tickMs: number;
};

export type ExpiredLease<T> = {
  leaseId: string;
  payload: T;
  expireAt: number;
};

export type ScheduledLease<T> = {
  leaseId: string;
  payload: T;
  expireAt: number;
  slot: number;
};
