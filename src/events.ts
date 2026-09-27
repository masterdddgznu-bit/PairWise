import type { LeaseEvent, LeaseEventType } from "./types.js";

export class EventLog {
  private seq = 0;
  private watermark = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(
    type: LeaseEventType,
    pool: string,
    resourceId: string,
    holderId: string,
    at: number,
  ): LeaseEvent {
    this.seq += 1;
    return { seq: this.seq, type, pool, resourceId, holderId, at };
  }

  watch(_fromSeq: number): string {
    throw new Error("watch not implemented");
  }

  pollWatch(_watchId: string): LeaseEvent[] {
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
