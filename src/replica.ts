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

  apply(_value: string | null, _ts: Timestamp): void {
    /* stub */
  }
}
