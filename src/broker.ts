import { VirtualClock } from "./clock.js";
import type { Delivery } from "./message.js";
import { Topic } from "./topic.js";
import { OffsetManager } from "./offset_manager.js";
import { DeliveryManager } from "./delivery_manager.js";
import { DeadLetterQueue } from "./dead_letter.js";
import { ConsumerGroupRegistry } from "./consumer_group.js";

export class Broker {
  private topics = new Map<string, Topic>();
  private clock: VirtualClock;
  private visibilityTimeout: number;
  private maxDeliveries: number;
  private offsets = new OffsetManager();
  private deliveries: DeliveryManager;
  private dlq = new DeadLetterQueue();
  private groups = new ConsumerGroupRegistry();

  constructor(opts?: {
    clock?: VirtualClock;
    visibilityTimeout?: number;
    maxDeliveries?: number;
  }) {
    this.clock = opts?.clock ?? new VirtualClock();
    this.visibilityTimeout = opts?.visibilityTimeout ?? 10;
    this.maxDeliveries = opts?.maxDeliveries ?? 3;
    this.deliveries = new DeliveryManager(this.clock, this.visibilityTimeout);
  }

  createTopic(name: string, partitionCount: number): void {
    this.topics.set(name, new Topic(partitionCount));
  }

  produce(
    topic: string,
    value: string,
    key?: string | null,
  ): { partition: number; offset: number } {
    const t = this.topics.get(topic);
    if (!t) throw new Error(`unknown topic ${topic}`);
    return t.produce(value, key);
  }

  joinGroup(groupId: string, consumerId: string, topics: string[]): void {
    this.groups.join(groupId, consumerId, topics);
  }

  leaveGroup(groupId: string, consumerId: string): void {
    this.groups.leave(groupId, consumerId);
  }

  poll(_groupId: string, _consumerId: string, _maxRecords?: number): Delivery[] {
    return [];
  }

  ack(_groupId: string, _consumerId: string, _deliveryId: string): void {}

  nack(_groupId: string, _consumerId: string, _deliveryId: string): void {}

  partitionEndOffset(topic: string, partition: number): number {
    const t = this.topics.get(topic);
    if (!t) return 0;
    return t.getPartition(partition).length();
  }

  committedOffset(groupId: string, topic: string, partition: number): number {
    return this.offsets.getCommitted(groupId, topic, partition);
  }

  deadLetters(topic: string) {
    return this.dlq.list(topic);
  }

  assignedPartitions(groupId: string, consumerId: string) {
    return this.groups.assigned(groupId, consumerId);
  }
}
