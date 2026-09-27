export type Message = {
  id: string;
  payload: string;
  priority: number;
  attempts: number;
  enqueuedAt: number;
};

export type EnqueueOpts = {
  priority?: number;
  delayMs?: number;
};

export type QueueEventType =
  | "enqueue"
  | "dequeue"
  | "ack"
  | "nack"
  | "expire"
  | "dead"
  | "redrive";

export type QueueEvent = {
  seq: number;
  type: QueueEventType;
  messageId: string;
  at: number;
};

export type WaitingItem = Message & {
  availableAt: number;
  seq: number;
};

export type InflightItem = Message & {
  visibleUntil: number;
};
