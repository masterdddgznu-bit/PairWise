import type { VersionVector } from "./types.js";
import { vvMin } from "./vv.js";

export class AckTable {
  private readonly acks = new Map<string, VersionVector>();

  ack(peer: string, vv: VersionVector): void {
    this.acks.set(peer, { ...vv });
  }

  minAck(): VersionVector {
    return vvMin([...this.acks.values()]);
  }

  peers(): string[] {
    return [...this.acks.keys()].sort();
  }
}
