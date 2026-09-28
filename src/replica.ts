import { cmpTs } from "./timestamp.js";
import type { ReplicaStore, Timestamp } from "./types.js";

export class Replica {
  readonly id: number;
  online = true;
  value: string | null = null;
  ts: Timestamp = { num: 0, writerId: 0 };

  constructor(id: number) {
    this.id = id;
  }

  store(): ReplicaStore {
    return { value: this.value, ts: { ...this.ts } };
  }

  apply(value: string | null, ts: Timestamp): void {
    if (cmpTs(ts, this.ts) > 0) {
      this.value = value;
      this.ts = { ...ts };
    }
  }
}
