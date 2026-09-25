import type { Message } from "./message.js";

/** Single-partition log — stub keeps no messages. */
export class Partition {
  append(_key: string | null, _value: string): number {
    return 0;
  }

  read(_offset: number): Message | undefined {
    return undefined;
  }

  length(): number {
    return 0;
  }
}
