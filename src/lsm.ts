export interface ScanItem {
  key: string;
  value: string;
}

interface Record {
  seq: number;
  key: string;
  /** null 表示墓碑 */
  value: string | null;
}

interface Sst {
  maxSeq: number;
  records: Record[];
}

/**
 * 简易 LSM:WAL + 追加式 memtable + 内存 SSTable 列表。
 */
export class Lsm {
  private seq = 0;
  private wal: Record[] = [];
  private mem: Record[] = [];
  private ssts: Sst[] = [];

  put(key: string, value: string): void {
    this.append(key, value);
  }

  del(key: string): void {
    this.append(key, null);
  }

  private append(key: string, value: string | null): void {
    this.seq += 1;
    const rec: Record = { seq: this.seq, key, value };
    this.wal.push(rec);
    this.mem.push(rec);
  }

  get(key: string): string | undefined {
    const rec = this.latest(key);
    return rec !== undefined && rec.value !== null ? rec.value : undefined;
  }

  private latest(key: string): Record | undefined {
    let best: Record | undefined;
    for (const rec of this.allRecords()) {
      if (rec.key === key && (best === undefined || rec.seq > best.seq)) {
        best = rec;
      }
    }
    return best;
  }

  private *allRecords(): Iterable<Record> {
    yield* this.mem;
    for (const sst of this.ssts) {
      yield* sst.records;
    }
  }

  /** [start, end) */
  scan(start: string, end: string): ScanItem[] {
    const visible = new Map<string, Record>();
    for (const rec of this.allRecords()) {
      if (rec.key < start || rec.key >= end) continue;
      const prev = visible.get(rec.key);
      if (prev === undefined || rec.seq > prev.seq) {
        visible.set(rec.key, rec);
      }
    }
    const items: ScanItem[] = [];
    for (const rec of visible.values()) {
      if (rec.value !== null) {
        items.push({ key: rec.key, value: rec.value });
      }
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return items;
  }

  flush(): void {
    if (this.mem.length === 0) return;
    const maxSeq = this.mem[this.mem.length - 1].seq;
    this.ssts.push({ maxSeq, records: this.mem });
    this.mem = [];
    this.wal = this.wal.filter((rec) => rec.seq > maxSeq);
  }

  crash(): void {
    this.mem = [];
  }

  recover(): void {
    for (const rec of this.wal) {
      this.mem.push(rec);
    }
  }

  /** 测试观察：memtable 条目数、SSTable 张数、WAL 剩余条数。 */
  stats(): { mem: number; sst: number; wal: number } {
    return { mem: this.mem.length, sst: this.ssts.length, wal: this.wal.length };
  }
}
