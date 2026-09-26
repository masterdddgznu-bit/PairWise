import type { RateEvent, RateEventType } from "./types.js";

/**
 * Event log + watch — starter stubs.
 */
export class EventLog {
  private seq = 0;
  private watermark = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(_type: RateEventType, _clientId: string, _at: number): RateEvent {
    throw new Error("event append not implemented");
  }

  watch(_fromSeq: number): string {
    throw new Error("watch not implemented");
  }

  pollWatch(_watchId: string): RateEvent[] {
    throw new Error("pollWatch not implemented");
  }

  unwatch(_watchId: string): void {
    throw new Error("unwatch not implemented");
  }

  compact(_beforeSeq: number): void {
    throw new Error("compact not implemented");
  }

  getWatermark(): number {
    return this.watermark;
  }
}
