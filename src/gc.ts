import type { VersionVector } from "./types.js";
import { vvMergeMax, vvMin } from "./vv.js";

export class AckTable {
  private readonly acks = new Map<string, VersionVector>();

  ack(peer: string, vv: VersionVector): void {
    const current = this.acks.get(peer);
    this.acks.set(
      peer,
      current === undefined ? { ...vv } : vvMergeMax(current, vv),
    );
  }

  minAck(): VersionVector {
    const vectors = [...this.acks.values()];
    return vectors.length === 0 ? {} : vvMin(vectors);
  }

  peers(): string[] {
    return [...this.acks.keys()].sort();
  }
}
