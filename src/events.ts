import type { AuthzEvent, AuthzEventType } from "./types.js";

export class EventLog {
  private seq = 0;

  currentSeq(): number {
    return this.seq;
  }

  append(
    type: AuthzEventType,
    subject: string,
    role: string,
    resource: string,
    at: number,
  ): AuthzEvent {
    this.seq += 1;
    return { seq: this.seq, type, subject, role, resource, at };
  }

  watch(_fromSeq: number): string {
    throw new Error("watch not implemented");
  }

  pollWatch(_watchId: string): AuthzEvent[] {
    throw new Error("pollWatch not implemented");
  }

  unwatch(_watchId: string): void {
    throw new Error("unwatch not implemented");
  }

  compact(_beforeSeq: number): void {
    throw new Error("compact not implemented");
  }
}
