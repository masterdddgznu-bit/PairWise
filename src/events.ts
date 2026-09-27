import type { CacheEvent, CacheEventType } from "./types.js";

export class EventLog {
  private seq = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(type: CacheEventType, key: string, at: number): CacheEvent {
    this.seq += 1;
    return { seq: this.seq, type, key, at };
  }

  watch(_fromSeq: number): string {
    throw new Error("watch not implemented");
  }

  pollWatch(_watchId: string): CacheEvent[] {
    throw new Error("pollWatch not implemented");
  }

  unwatch(_watchId: string): void {
    throw new Error("unwatch not implemented");
  }

  compact(_beforeSeq: number): void {
    throw new Error("compact not implemented");
  }
}
