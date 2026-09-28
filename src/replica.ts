import type { ReplicaStore, Timestamp } from "./types.js";
import { cmpTs } from "./timestamp.js";

export class Replica {
  readonly id: number;
  online = true;
  value: string | null = null;
  ts: Timestamp = { num: 0, writerId: 0 };

  constructor(id: number) {
    this.id = id;
  }

  store(): ReplicaStore {
    return { value: this.value, ts: { num: this.ts.num, writerId: this.ts.writerId } };
  }

  apply(value: string | null, ts: Timestamp): void {
    if (cmpTs(ts, this.ts) < 0) {
      return;
    }
    this.value = value;
    this.ts = { num: ts.num, writerId: ts.writerId };
  }
}
