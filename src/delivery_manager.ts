import type { VirtualClock } from "./clock.js";
import type { Delivery } from "./message.js";

export interface InflightRecord {
  deliveryId: string;
  groupId: string;
  consumerId: string;
  topic: string;
  partition: number;
  offset: number;
  key: string | null;
  value: string;
  deliveryCount: number;
  visibilityDeadline: number;
}

/** Inflight deliveries, visibility timeouts and redelivery counting. */
export class DeliveryManager {
  private inflight = new Map<string, InflightRecord>();
  private inflightOffsets = new Set<string>();
  private deliveryCounts = new Map<string, number>();
  private seq = 0;

  constructor(
    private clock: VirtualClock,
    private visibilityTimeout: number,
  ) {}

  private offsetKey(groupId: string, topic: string, partition: number, offset: number): string {
    return `${groupId}|${topic}|${partition}|${offset}`;
  }

  createInflight(
    rec: Omit<InflightRecord, "deliveryId" | "visibilityDeadline" | "deliveryCount">,
  ): Delivery {
    const offsetKey = this.offsetKey(rec.groupId, rec.topic, rec.partition, rec.offset);
    const deliveryCount = (this.deliveryCounts.get(offsetKey) ?? 0) + 1;
    this.deliveryCounts.set(offsetKey, deliveryCount);
    const record: InflightRecord = {
      ...rec,
      deliveryId: `delivery-${++this.seq}`,
      deliveryCount,
      visibilityDeadline: this.clock.now() + this.visibilityTimeout,
    };
    this.inflight.set(record.deliveryId, record);
    this.inflightOffsets.add(offsetKey);
    return {
      deliveryId: record.deliveryId,
      topic: record.topic,
      partition: record.partition,
      offset: record.offset,
      key: record.key,
      value: record.value,
      deliveryCount: record.deliveryCount,
    };
  }

  removeInflight(deliveryId: string): InflightRecord | undefined {
    const record = this.inflight.get(deliveryId);
    if (!record) return undefined;
    this.inflight.delete(deliveryId);
    this.inflightOffsets.delete(
      this.offsetKey(record.groupId, record.topic, record.partition, record.offset),
    );
    return record;
  }

  getInflight(deliveryId: string): InflightRecord | undefined {
    return this.inflight.get(deliveryId);
  }

  isOffsetInflight(groupId: string, topic: string, partition: number, offset: number): boolean {
    return this.inflightOffsets.has(this.offsetKey(groupId, topic, partition, offset));
  }

  /** Removes and returns this group's inflight records past their visibility deadline. */
  expireTimedOut(groupId: string): InflightRecord[] {
    const now = this.clock.now();
    const expired: InflightRecord[] = [];
    for (const record of this.inflight.values()) {
      if (record.groupId === groupId && record.visibilityDeadline <= now) {
        expired.push(record);
      }
    }
    for (const record of expired) {
      this.removeInflight(record.deliveryId);
    }
    return expired;
  }
}
