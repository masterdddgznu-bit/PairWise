export interface ScanItem {
  key: string;
  value: string;
}

interface Record {
  seq: number;
  value: string | null; // null 表示墓碑
}

interface WalEntry extends Record {
  key: string;
}

type MemTable = WalEntry[]; // 每次变更一条记录，不去重
type SstTable = Map<string, Record>; // 刷盘时按 key 收敛为最新记录

/**
 * 简易进程内 LSM：WAL + memtable + 内存 SSTable 列表。
 */
export class Lsm {
  private mem: MemTable = [];
  private ssts: SstTable[] = []; // 越靠后越新
  private wal: WalEntry[] = [];
  private nextSeq = 1;

  put(key: string, value: string): void {
    this.apply(key, value);
  }

  del(key: string): void {
    this.apply(key, null);
  }

  private apply(key: string, value: string | null): void {
    const entry: WalEntry = { key, seq: this.nextSeq++, value };
    this.wal.push(entry);
    this.mem.push(entry);
  }

  get(key: string): string | undefined {
    const rec = this.findInMem(key) ?? this.findInSsts(key);
    if (!rec || rec.value === null) return undefined;
    return rec.value;
  }

  private findInMem(key: string): Record | undefined {
    for (let i = this.mem.length - 1; i >= 0; i--) {
      if (this.mem[i].key === key) return this.mem[i];
    }
    return undefined;
  }

  private findInSsts(key: string): Record | undefined {
    for (let i = this.ssts.length - 1; i >= 0; i--) {
      const rec = this.ssts[i].get(key);
      if (rec) return rec;
    }
    return undefined;
  }

  /** [start, end) */
  scan(start: string, end: string): ScanItem[] {
    const merged = new Map<string, Record>();
    for (const sst of this.ssts) {
      for (const [key, rec] of sst) merged.set(key, rec);
    }
    for (const entry of this.mem) merged.set(entry.key, entry);

    const items: ScanItem[] = [];
    for (const [key, rec] of merged) {
      if (rec.value === null) continue;
      if (key < start || key >= end) continue;
      items.push({ key, value: rec.value });
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return items;
  }

  flush(): void {
    if (this.mem.length === 0) return;
    const sst: SstTable = new Map();
    let maxSeq = 0;
    for (const entry of this.mem) {
      sst.set(entry.key, { seq: entry.seq, value: entry.value });
      if (entry.seq > maxSeq) maxSeq = entry.seq;
    }
    this.ssts.push(sst);
    this.mem = [];
    this.wal = this.wal.filter((e) => e.seq > maxSeq);
  }

  crash(): void {
    this.mem = [];
  }

  recover(): void {
    this.mem = [];
    for (const entry of this.wal) {
      this.mem.push(entry);
      if (entry.seq >= this.nextSeq) this.nextSeq = entry.seq + 1;
    }
  }

  /** 测试观察：memtable 条目数、SSTable 张数、WAL 剩余条数。 */
  stats(): { mem: number; sst: number; wal: number } {
    return { mem: this.mem.length, sst: this.ssts.length, wal: this.wal.length };
  }
}
