import type { StreamRecord } from "./types.js";
import { LateBuffer } from "./late_buffer.js";

/** Late-event side output stream. */
export class SideOutput {
  private records: StreamRecord[] = [];
  private buffer = new LateBuffer();

  emit(record: StreamRecord): void {
    this.records.push(this.buffer.drain(record));
  }

  all(): StreamRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  restore(records: StreamRecord[]): void {
    this.records = records.map((r) => ({ ...r }));
  }
}
