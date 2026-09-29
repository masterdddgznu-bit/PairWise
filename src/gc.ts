import type { VersionVector } from "./types.js";
import { vvGet, vvMin } from "./vv.js";

export class AckTable {
  private readonly acks = new Map<string, VersionVector>();

  ack(peer: string, vv: VersionVector): void {
    const merged: VersionVector = { ...(this.acks.get(peer) ?? {}) };
    for (const [key, counter] of Object.entries(vv)) {
      merged[key] = Math.max(vvGet(merged, key), counter);
    }
    this.acks.set(peer, merged);
  }

  minAck(): VersionVector {
    return vvMin([...this.acks.values()]);
  }

  peers(): string[] {
    return [...this.acks.keys()];
  }
}
