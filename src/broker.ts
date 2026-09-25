import { VirtualClock } from "./clock.js";
import type { Delivery } from "./message.js";
import { Topic } from "./topic.js";
import { OffsetManager } from "./offset_manager.js";
import { DeliveryManager, type InflightRecord } from "./delivery_manager.js";
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

  poll(groupId: string, consumerId: string, maxRecords = 1): Delivery[] {
    for (const rec of this.deliveries.expireTimedOut(groupId)) {
      if (rec.deliveryCount >= this.maxDeliveries) {
        this.sendToDeadLetter(rec);
      }
    }

    const out: Delivery[] = [];
    const assignments = this.groups.assigned(
      groupId,
      consumerId,
      (topic) => this.topics.get(topic)?.partitionCount() ?? 0,
    );
    for (const assignment of assignments) {
      if (out.length >= maxRecords) break;
      const topic = this.topics.get(assignment.topic);
      if (!topic) continue;
      const partition = topic.getPartition(assignment.partition);
      let offset = this.offsets.getCommitted(groupId, assignment.topic, assignment.partition);
      while (out.length < maxRecords && offset < partition.length()) {
        if (this.deliveries.isOffsetInflight(groupId, assignment.topic, assignment.partition, offset)) {
          break;
        }
        const msg = partition.read(offset);
        if (!msg) break;
        out.push(
          this.deliveries.createInflight({
            groupId,
            consumerId,
            topic: assignment.topic,
            partition: assignment.partition,
            offset,
            key: msg.key,
            value: msg.value,
          }),
        );
        offset++;
      }
    }
    return out;
  }

  ack(groupId: string, _consumerId: string, deliveryId: string): void {
    const rec = this.deliveries.removeInflight(deliveryId);
    if (!rec || rec.groupId !== groupId) return;
    this.offsets.commit(groupId, rec.topic, rec.partition, rec.offset);
  }

  nack(groupId: string, _consumerId: string, deliveryId: string): void {
    const rec = this.deliveries.removeInflight(deliveryId);
    if (!rec || rec.groupId !== groupId) return;
    if (rec.deliveryCount >= this.maxDeliveries) {
      this.sendToDeadLetter(rec);
    }
  }

  private sendToDeadLetter(rec: InflightRecord): void {
    this.dlq.add(rec.topic, {
      partition: rec.partition,
      offset: rec.offset,
      key: rec.key,
      value: rec.value,
      deliveryCount: rec.deliveryCount,
    });
    this.offsets.commit(rec.groupId, rec.topic, rec.partition, rec.offset);
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
    return this.groups.assigned(
      groupId,
      consumerId,
      (topic) => this.topics.get(topic)?.partitionCount() ?? 0,
    );
  }
}
