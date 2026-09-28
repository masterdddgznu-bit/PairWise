import { VirtualClock } from "./clock.js";
import { MemTable } from "./memtable.js";
import type { CheckpointMeta, DurabilityInfo, WalRecord } from "./types.js";

/**
 * WAL-backed KV with secondary index (feature incomplete).
 * Base memtable put/get/delete/has/keys/size work.
 */
export class WalKV {
  readonly clock: VirtualClock;
  /** @internal */ readonly mem: MemTable;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.mem = new MemTable();
  }

  put(key: string, value: string): void {
    this.mem.put(key, value);
  }

  get(key: string): string | undefined {
    return this.mem.get(key);
  }

  delete(key: string): boolean {
    return this.mem.delete(key);
  }

  has(key: string): boolean {
    return this.mem.has(key);
  }

  keys(): string[] {
    return this.mem.keys();
  }

  size(): number {
    return this.mem.size();
  }

  walRecords(): WalRecord[] {
    throw new Error("walRecords not implemented");
  }

  nextLsn(): number {
    throw new Error("nextLsn not implemented");
  }

  checkpoint(): CheckpointMeta {
    throw new Error("checkpoint not implemented");
  }

  latestCheckpoint(): CheckpointMeta | null {
    throw new Error("latestCheckpoint not implemented");
  }

  crashAndRecover(): void {
    throw new Error("crashAndRecover not implemented");
  }

  findByValue(_value: string): string[] {
    throw new Error("findByValue not implemented");
  }

  durability(): DurabilityInfo {
    throw new Error("durability not implemented");
  }
}
