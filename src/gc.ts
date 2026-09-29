import type { VersionVector } from "./types.js";
import { vvMin } from "./vv.js";

export class AckTable {
  private readonly acks = new Map<string, VersionVector>();

  ack(peer: string, vv: VersionVector): void {
    const cur = this.acks.get(peer) ?? {};
    const merged: VersionVector = { ...cur };
    for (const [replicaId, counter] of Object.entries(vv)) {
      merged[replicaId] = Math.max(merged[replicaId] ?? 0, counter);
    }
    this.acks.set(peer, merged);
  }

  minAck(): VersionVector {
    return vvMin([...this.acks.values()]);
  }

  peers(): string[] {
    return [...this.acks.keys()].sort();
  }
}
