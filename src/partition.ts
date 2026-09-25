import type { Message } from "./message.js";

/** Single-partition append-only log with contiguous offsets from 0. */
export class Partition {
  private messages: Message[] = [];

  append(key: string | null, value: string): number {
    const offset = this.messages.length;
    this.messages.push({ offset, key, value });
    return offset;
  }

  read(offset: number): Message | undefined {
    return this.messages[offset];
  }

  length(): number {
    return this.messages.length;
  }
}
