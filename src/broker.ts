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
  private groups: ConsumerGroupRegistry;

  constructor(opts?: {
    clock?: VirtualClock;
    visibilityTimeout?: number;
    maxDeliveries?: number;
  }) {
    this.clock = opts?.clock ?? new VirtualClock();
    this.visibilityTimeout = opts?.visibilityTimeout ?? 10;
    this.maxDeliveries = opts?.maxDeliveries ?? 3;
    this.deliveries = new DeliveryManager(this.clock, this.visibilityTimeout);
    this.groups = new ConsumerGroupRegistry(
      (topic) => this.topics.get(topic)?.partitionCount() ?? 0,
    );
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

  poll(groupId: string, consumerId: string, maxRecords = 100): Delivery[] {
    this.expireAndDeadLetter(groupId);
    const out: Delivery[] = [];
    for (const assignment of this.groups.assigned(groupId, consumerId)) {
      if (out.length >= maxRecords) break;
      const topic = this.topics.get(assignment.topic);
      if (!topic) continue;
      const partition = topic.getPartition(assignment.partition);
      let offset = this.offsets.getCommitted(groupId, assignment.topic, assignment.partition);
      while (out.length < maxRecords && offset < partition.length()) {
        if (
          this.deliveries.isOffsetInflight(groupId, assignment.topic, assignment.partition, offset)
        ) {
          break;
        }
        const message = partition.read(offset);
        if (!message) break;
        out.push(
          this.deliveries.createInflight({
            groupId,
            consumerId,
            topic: assignment.topic,
            partition: assignment.partition,
            offset,
            key: message.key,
            value: message.value,
          }),
        );
        offset++;
      }
    }
    return out;
  }

  ack(groupId: string, _consumerId: string, deliveryId: string): void {
    const record = this.deliveries.removeInflight(deliveryId);
    if (!record || record.groupId !== groupId) return;
    const committed = this.offsets.getCommitted(groupId, record.topic, record.partition);
    if (record.offset + 1 > committed) {
      this.offsets.setCommitted(groupId, record.topic, record.partition, record.offset + 1);
    }
  }

  nack(groupId: string, _consumerId: string, deliveryId: string): void {
    const record = this.deliveries.getInflight(deliveryId);
    if (!record || record.groupId !== groupId) return;
    this.deliveries.removeInflight(deliveryId);
  }

  private expireAndDeadLetter(groupId: string): void {
    for (const record of this.deliveries.expireTimedOut(groupId)) {
      if (record.deliveryCount >= this.maxDeliveries) {
        this.dlq.add(record.topic, {
          partition: record.partition,
          offset: record.offset,
          key: record.key,
          value: record.value,
          deliveryCount: record.deliveryCount,
        });
        const committed = this.offsets.getCommitted(groupId, record.topic, record.partition);
        if (record.offset + 1 > committed) {
          this.offsets.setCommitted(groupId, record.topic, record.partition, record.offset + 1);
        }
      }
    }
  }

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
