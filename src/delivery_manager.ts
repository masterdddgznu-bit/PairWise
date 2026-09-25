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

/** Inflight + visibility — stub delivers nothing. */
export class DeliveryManager {
  constructor(_clock: VirtualClock, _visibilityTimeout: number) {}

  createInflight(_rec: Omit<InflightRecord, "deliveryId" | "visibilityDeadline">): Delivery {
    return {
      deliveryId: "stub",
      topic: "",
      partition: 0,
      offset: 0,
      key: null,
      value: "",
      deliveryCount: 0,
    };
  }

  removeInflight(_deliveryId: string): InflightRecord | undefined {
    return undefined;
  }

  getInflight(_deliveryId: string): InflightRecord | undefined {
    return undefined;
  }

  isOffsetInflight(_groupId: string, _topic: string, _partition: number, _offset: number): boolean {
    return false;
  }

  expireTimedOut(_groupId: string): void {
    /* no-op */
  }
}
