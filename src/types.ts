export type PendingItem<T> = {
  payload: T;
  enqueuedAt: number;
};

export type PendingRecord<T> = {
  tenant: string;
  payload: T;
  enqueuedAt: number;
};

export type BatchSnapshot<T = string> = {
  pending: PendingRecord<T>[];
};
