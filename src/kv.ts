import { VirtualClock } from "./clock.js";
import { CheckpointStore } from "./checkpoint.js";
import { MemTable } from "./memtable.js";
import { recoverInto } from "./recover.js";
import { SecondaryIndex } from "./secindex.js";
import type { CheckpointMeta, DurabilityInfo, WalRecord } from "./types.js";
import { WalLog } from "./wal.js";

/**
 * WAL-backed KV with secondary index.
 */
export class WalKV {
  readonly clock: VirtualClock;
  /** @internal */ readonly mem: MemTable;
  private readonly wal = new WalLog();
  private readonly checkpoints = new CheckpointStore();
  private readonly idx = new SecondaryIndex();

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.mem = new MemTable();
  }

  put(key: string, value: string): void {
    this.wal.append({ op: "put", key, value, at: this.clock.now() });
    const old = this.mem.get(key);
    this.mem.put(key, value);
    if (old !== undefined) this.idx.remove(key, old);
    this.idx.add(key, value);
  }

  get(key: string): string | undefined {
    return this.mem.get(key);
  }

  delete(key: string): boolean {
    const old = this.mem.get(key);
    if (old === undefined) return false;
    this.wal.append({ op: "delete", key, at: this.clock.now() });
    this.mem.delete(key);
    this.idx.remove(key, old);
    return true;
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
    return this.wal.records();
  }

  nextLsn(): number {
    return this.wal.nextLsn();
  }

  checkpoint(): CheckpointMeta {
    const meta: CheckpointMeta = {
      lsn: this.wal.lastLsn(),
      at: this.clock.now(),
      keys: this.mem.size(),
    };
    this.checkpoints.save({ ...meta, data: this.mem.cloneMap() });
    this.wal.truncateUpTo(meta.lsn);
    return meta;
  }

  latestCheckpoint(): CheckpointMeta | null {
    const snap = this.checkpoints.latest();
    return snap ? { lsn: snap.lsn, at: snap.at, keys: snap.keys } : null;
  }

  crashAndRecover(): void {
    recoverInto(this.mem, this.idx, this.checkpoints.latest(), this.wal.records());
  }

  findByValue(value: string): string[] {
    return this.idx.find(value);
  }

  durability(): DurabilityInfo {
    return {
      walLen: this.wal.records().length,
      checkpointLsn: this.checkpoints.latest()?.lsn ?? null,
    };
  }
}
