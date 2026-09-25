import type { StreamRecord } from "./types.js";

/** Small buffer before side output — passes through immediately. */
export class LateBuffer {
  drain(record: StreamRecord): StreamRecord {
    return { ...record };
  }
}
