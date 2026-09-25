export type OutboxStatus = "pending" | "in_flight" | "published";

export type OutboxMessage = {
  offset: number;
  messageId: string;
  key: string;
  payload: string;
  status: OutboxStatus;
  visibilityDeadline?: number;
  nextAttemptAt?: number;
  attempts: number;
};

export type BusMessage = {
  messageId: string;
  key: string;
  payload: string;
  offset: number;
};

export type OutboxStats = {
  pending: number;
  inFlight: number;
  published: number;
};
