import type { VersionVector } from "./types.js";

export class AckTable {
  ack(_peer: string, _vv: VersionVector): void {
    throw new Error("ack not implemented");
  }

  minAck(): VersionVector {
    throw new Error("minAck not implemented");
  }

  peers(): string[] {
    return [];
  }
}
