export interface StoreStats {
  active: number;
  log: number;
  dirty: number;
  disk: number;
}

type Image = string | null;

interface Page {
  value: Image;
  pageLsn: number;
}

interface UpdateRecord {
  type: "update";
  lsn: number;
  tx: number;
  prevLsn: number;
  key: string;
  before: Image;
  after: Image;
}

interface ClrRecord {
  type: "clr";
  lsn: number;
  tx: number;
  prevLsn: number;
  key: string;
  before: Image;
  after: Image;
  undoNext: number;
}

interface EndRecord {
  type: "commit" | "abort";
  lsn: number;
  tx: number;
  prevLsn: number;
}

interface CheckpointRecord {
  type: "checkpoint";
  lsn: number;
  active: Array<{ tx: number; lastLsn: number }>;
  dirty: Array<{ key: string; recLsn: number }>;
}

type LogRecord = UpdateRecord | ClrRecord | EndRecord | CheckpointRecord;

interface TxEntry {
  id: number;
  lastLsn: number;
  locks: Set<string>;
}

/**
 * 可恢复页存储。恢复语义接近 ARIES：可偷取脏页、提交不强制刷盘、模糊检查点。
 */
export class Store {
  private log: LogRecord[] = [];
  private buffer = new Map<string, Page>();
  private disk = new Map<string, Page>();
  private dirty = new Map<string, number>();
  private txs = new Map<number, TxEntry>();
  private locks = new Map<string, number>();
  private committed = new Map<string, Image>();
  private nextTx = 1;
  private crashed = false;

  private ensureRunning(): void {
    if (this.crashed) {
      throw new Error("store is crashed; call recover() first");
    }
  }

  private requireTx(tx: number): TxEntry {
    const entry = this.txs.get(tx);
    if (!entry) {
      throw new Error(`transaction ${tx} is not active`);
    }
    return entry;
  }

  private currentImage(key: string): Image {
    const buffered = this.buffer.get(key);
    if (buffered) {
      return buffered.value;
    }
    const flushed = this.disk.get(key);
    return flushed ? flushed.value : null;
  }

  private applyToBuffer(key: string, value: Image, lsn: number): void {
    let page = this.buffer.get(key);
    if (!page) {
      const flushed = this.disk.get(key);
      page = { value: flushed ? flushed.value : null, pageLsn: flushed ? flushed.pageLsn : 0 };
      this.buffer.set(key, page);
    }
    page.value = value;
    page.pageLsn = lsn;
    if (!this.dirty.has(key)) {
      this.dirty.set(key, lsn);
    }
  }

  private writeUpdate(tx: number, key: string, after: Image): void {
    const entry = this.requireTx(tx);
    const holder = this.locks.get(key);
    if (holder !== undefined && holder !== tx) {
      throw new Error(`key "${key}" is locked by transaction ${holder}`);
    }
    const before = this.currentImage(key);
    const lsn = this.log.length + 1;
    this.log.push({ type: "update", lsn, tx, prevLsn: entry.lastLsn, key, before, after });
    entry.lastLsn = lsn;
    entry.locks.add(key);
    this.locks.set(key, tx);
    this.applyToBuffer(key, after, lsn);
  }

  private undo(entry: TxEntry): void {
    let lsn = entry.lastLsn;
    while (lsn !== 0) {
      const record = this.log[lsn - 1];
      if (record.type === "update") {
        const clrLsn = this.log.length + 1;
        this.log.push({
          type: "clr",
          lsn: clrLsn,
          tx: entry.id,
          prevLsn: entry.lastLsn,
          key: record.key,
          before: record.after,
          after: record.before,
          undoNext: record.prevLsn,
        });
        entry.lastLsn = clrLsn;
        this.applyToBuffer(record.key, record.before, clrLsn);
        lsn = record.prevLsn;
      } else if (record.type === "clr") {
        lsn = record.undoNext;
      } else {
        lsn = 0;
      }
    }
  }

  begin(): number {
    this.ensureRunning();
    const id = this.nextTx++;
    this.txs.set(id, { id, lastLsn: 0, locks: new Set() });
    return id;
  }

  put(tx: number, key: string, value: string): void {
    this.ensureRunning();
    this.writeUpdate(tx, key, value);
  }

  del(tx: number, key: string): void {
    this.ensureRunning();
    const holder = this.locks.get(key);
    if (holder === undefined && this.currentImage(key) === null) {
      this.requireTx(tx);
      return;
    }
    this.writeUpdate(tx, key, null);
  }

  get(tx: number, key: string): string | undefined {
    this.ensureRunning();
    const entry = this.requireTx(tx);
    const image = entry.locks.has(key) ? this.currentImage(key) : (this.committed.get(key) ?? null);
    return image === null ? undefined : image;
  }

  read(key: string): string | undefined {
    if (this.crashed) {
      return undefined;
    }
    const image = this.committed.get(key) ?? null;
    return image === null ? undefined : image;
  }

  commit(tx: number): void {
    this.ensureRunning();
    const entry = this.requireTx(tx);
    const lsn = this.log.length + 1;
    this.log.push({ type: "commit", lsn, tx, prevLsn: entry.lastLsn });
    for (const key of entry.locks) {
      this.committed.set(key, this.currentImage(key));
      this.locks.delete(key);
    }
    this.txs.delete(tx);
  }

  abort(tx: number): void {
    this.ensureRunning();
    const entry = this.requireTx(tx);
    this.undo(entry);
    const lsn = this.log.length + 1;
    this.log.push({ type: "abort", lsn, tx, prevLsn: entry.lastLsn });
    for (const key of entry.locks) {
      this.locks.delete(key);
    }
    this.txs.delete(tx);
  }

  flush(): void {
    this.ensureRunning();
    for (const key of this.dirty.keys()) {
      const page = this.buffer.get(key);
      if (page) {
        this.disk.set(key, { value: page.value, pageLsn: page.pageLsn });
      }
    }
    this.dirty.clear();
  }

  checkpoint(): void {
    this.ensureRunning();
    const lsn = this.log.length + 1;
    this.log.push({
      type: "checkpoint",
      lsn,
      active: [...this.txs.values()].map((entry) => ({ tx: entry.id, lastLsn: entry.lastLsn })),
      dirty: [...this.dirty.entries()].map(([key, recLsn]) => ({ key, recLsn })),
    });
  }

  crash(): void {
    this.buffer.clear();
    this.dirty.clear();
    this.txs.clear();
    this.locks.clear();
    this.committed.clear();
    this.crashed = true;
  }

  recover(): void {
    if (!this.crashed) {
      throw new Error("store is not crashed");
    }

    let start = 0;
    let lastCheckpoint: CheckpointRecord | null = null;
    for (const record of this.log) {
      if (record.type === "checkpoint") {
        lastCheckpoint = record;
      }
    }
    if (lastCheckpoint) {
      for (const entry of lastCheckpoint.active) {
        this.txs.set(entry.tx, { id: entry.tx, lastLsn: entry.lastLsn, locks: new Set() });
      }
      for (const page of lastCheckpoint.dirty) {
        this.dirty.set(page.key, page.recLsn);
      }
      start = lastCheckpoint.lsn;
    }

    let maxTx = 0;
    for (const record of this.log) {
      if (record.type === "checkpoint") {
        for (const entry of record.active) {
          maxTx = Math.max(maxTx, entry.tx);
        }
      } else {
        maxTx = Math.max(maxTx, record.tx);
      }
    }
    this.nextTx = Math.max(this.nextTx, maxTx + 1);

    for (let i = start; i < this.log.length; i++) {
      const record = this.log[i];
      if (record.type === "update" || record.type === "clr") {
        let entry = this.txs.get(record.tx);
        if (!entry) {
          entry = { id: record.tx, lastLsn: 0, locks: new Set() };
          this.txs.set(record.tx, entry);
        }
        entry.lastLsn = record.lsn;
        if (!this.dirty.has(record.key)) {
          this.dirty.set(record.key, record.lsn);
        }
      } else if (record.type === "commit" || record.type === "abort") {
        this.txs.delete(record.tx);
      }
    }

    let redoStart = this.log.length + 1;
    for (const recLsn of this.dirty.values()) {
      redoStart = Math.min(redoStart, recLsn);
    }
    for (let lsn = redoStart; lsn <= this.log.length; lsn++) {
      const record = this.log[lsn - 1];
      if (record.type !== "update" && record.type !== "clr") {
        continue;
      }
      let page = this.buffer.get(record.key);
      if (!page) {
        const flushed = this.disk.get(record.key);
        page = { value: flushed ? flushed.value : null, pageLsn: flushed ? flushed.pageLsn : 0 };
        this.buffer.set(record.key, page);
      }
      if (page.pageLsn >= record.lsn) {
        continue;
      }
      page.value = record.after;
      page.pageLsn = record.lsn;
      if (!this.dirty.has(record.key)) {
        this.dirty.set(record.key, record.lsn);
      }
    }

    const losers = [...this.txs.values()].sort((a, b) => a.id - b.id);
    for (const entry of losers) {
      this.undo(entry);
      const lsn = this.log.length + 1;
      this.log.push({ type: "abort", lsn, tx: entry.id, prevLsn: entry.lastLsn });
      this.txs.delete(entry.id);
    }

    this.committed.clear();
    for (const [key, page] of this.disk) {
      this.committed.set(key, page.value);
    }
    for (const [key, page] of this.buffer) {
      this.committed.set(key, page.value);
    }
    this.crashed = false;
  }

  stats(): StoreStats {
    return {
      active: this.txs.size,
      log: this.log.length,
      dirty: this.dirty.size,
      disk: this.disk.size,
    };
  }
}
