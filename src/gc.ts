import type { VersionVector } from "./types.js";
import { vvGet, vvMin } from "./vv.js";
import type { Entry } from "./types.js";
import type { EntryStore } from "./entries.js";

export class AckTable {
  private readonly acks = new Map<string, VersionVector>();

  /** Record a peer's acknowledged vv, taking the per-key max. */
  ack(peer: string, vv: VersionVector): void {
    const prev = this.acks.get(peer) ?? {};
    const merged: VersionVector = { ...prev };
    for (const [id, counter] of Object.entries(vv)) {
      if (counter > vvGet(merged, id)) merged[id] = counter;
    }
    this.acks.set(peer, merged);
  }

  /** Per-key min across every acked peer; `{}` when nothing was acked. */
  minAck(): VersionVector {
    if (this.acks.size === 0) return {};
    return vvMin([...this.acks.values()]);
  }

  peers(): string[] {
    return [...this.acks.keys()].sort();
  }
}

/**
 * Drop tombstones whose dot is fully covered by the minimum ACK vector.
 * Live entries are never removed.
 */
export function sweepTombstones(store: EntryStore, minAck: VersionVector): number {
  return store.removeTombstones(
    (e: Entry) => e.dot.counter <= vvGet(minAck, e.dot.replicaId),
  );
}
