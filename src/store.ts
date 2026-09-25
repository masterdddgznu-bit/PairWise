export interface StoreStats {
  active: number;
  log: number;
  dirty: number;
  disk: number;
}

type Image = string | null;

type LogRecord =
  | { kind: "update"; lsn: number; tx: number; prevLsn: number; key: string; before: Image; after: Image }
  | { kind: "clr"; lsn: number; tx: number; prevLsn: number; key: string; undoNext: number; image: Image }
  | { kind: "commit"; lsn: number; tx: number; prevLsn: number }
  | { kind: "abort"; lsn: number; tx: number; prevLsn: number }
  | { kind: "checkpoint"; lsn: number; txns: Record<number, number>; dirty: Record<string, number> };

interface Page {
  lsn: number;
  image: Image;
}

interface TxnState {
  lastLsn: number;
  keys: Set<string>;
}

/**
 * 可恢复页存储（ARIES 风格：偷页 + 无强制刷盘 + 模糊检查点）。
 */
export class Store {
  private log: LogRecord[] = [];
  private buffer = new Map<string, Page>();
  private disk = new Map<string, Page>();
  private dirty = new Map<string, number>();
  private txns = new Map<number, TxnState>();
  private committed = new Map<string, Image>();
  private keyLocks = new Map<string, number>();
  private nextTx = 1;
  private crashed = false;

  begin(): number {
    this.ensureRunning();
    const tx = this.nextTx++;
    this.txns.set(tx, { lastLsn: 0, keys: new Set() });
    return tx;
  }

  put(tx: number, key: string, value: string): void {
    this.ensureRunning();
    const state = this.requireTx(tx);
    const owner = this.keyLocks.get(key);
    if (owner !== undefined && owner !== tx) {
      throw new Error(`key ${key} is locked by transaction ${owner}`);
    }
    const before = this.pageImage(key);
    const lsn = this.nextLsn();
    this.log.push({ kind: "update", lsn, tx, prevLsn: state.lastLsn, key, before, after: value });
    state.lastLsn = lsn;
    if (!state.keys.has(key)) {
      state.keys.add(key);
      this.keyLocks.set(key, tx);
    }
    this.apply(key, value, lsn);
  }

  del(tx: number, key: string): void {
    this.ensureRunning();
    const state = this.requireTx(tx);
    const owner = this.keyLocks.get(key);
    if (owner !== undefined && owner !== tx) {
      throw new Error(`key ${key} is locked by transaction ${owner}`);
    }
    const before = this.pageImage(key);
    if (before === null && !state.keys.has(key)) {
      return;
    }
    const lsn = this.nextLsn();
    this.log.push({ kind: "update", lsn, tx, prevLsn: state.lastLsn, key, before, after: null });
    state.lastLsn = lsn;
    if (!state.keys.has(key)) {
      state.keys.add(key);
      this.keyLocks.set(key, tx);
    }
    this.apply(key, null, lsn);
  }

  get(tx: number, key: string): string | undefined {
    this.ensureRunning();
    const state = this.requireTx(tx);
    if (state.keys.has(key)) {
      return this.undef(this.buffer.get(key)?.image ?? null);
    }
    return this.read(key);
  }

  read(key: string): string | undefined {
    if (this.crashed) {
      return undefined;
    }
    return this.undef(this.committed.get(key) ?? null);
  }

  commit(tx: number): void {
    this.ensureRunning();
    const state = this.requireTx(tx);
    this.log.push({ kind: "commit", lsn: this.nextLsn(), tx, prevLsn: state.lastLsn });
    for (const key of state.keys) {
      this.committed.set(key, this.buffer.get(key)?.image ?? null);
      this.keyLocks.delete(key);
    }
    this.txns.delete(tx);
  }

  abort(tx: number): void {
    this.ensureRunning();
    const state = this.requireTx(tx);
    this.undoChain(tx, state.lastLsn);
    const lastLsn = this.txns.get(tx)?.lastLsn ?? state.lastLsn;
    this.log.push({ kind: "abort", lsn: this.nextLsn(), tx, prevLsn: lastLsn });
    for (const key of state.keys) {
      this.committed.set(key, this.pageImage(key));
      this.keyLocks.delete(key);
    }
    this.txns.delete(tx);
  }

  flush(): void {
    this.ensureRunning();
    for (const key of this.dirty.keys()) {
      const buffered = this.buffer.get(key);
      if (buffered !== undefined) {
        this.disk.set(key, { lsn: buffered.lsn, image: buffered.image });
      }
    }
    this.dirty.clear();
  }

  checkpoint(): void {
    this.ensureRunning();
    const txns: Record<number, number> = {};
    for (const [tx, state] of this.txns) {
      txns[tx] = state.lastLsn;
    }
    const dirty: Record<string, number> = {};
    for (const [key, recLsn] of this.dirty) {
      dirty[key] = recLsn;
    }
    this.log.push({ kind: "checkpoint", lsn: this.nextLsn(), txns, dirty });
  }

  crash(): void {
    this.buffer = new Map();
    this.dirty = new Map();
    this.txns = new Map();
    this.committed = new Map();
    this.keyLocks = new Map();
    this.crashed = true;
  }

  recover(): void {
    const { txns, dirty } = this.analyze();
    this.redo(dirty);
    this.undoLosers(txns);
    for (const [key, page] of this.disk) {
      if (!this.buffer.has(key)) {
        this.committed.set(key, page.image);
      }
    }
    for (const [key, page] of this.buffer) {
      this.committed.set(key, page.image);
    }
    this.crashed = false;
  }

  stats(): StoreStats {
    return {
      active: this.txns.size,
      log: this.log.length,
      dirty: this.dirty.size,
      disk: this.disk.size,
    };
  }

  private nextLsn(): number {
    return this.log.length + 1;
  }

  private ensureRunning(): void {
    if (this.crashed) {
      throw new Error("store has crashed; call recover() first");
    }
  }

  private requireTx(tx: number): TxnState {
    const state = this.txns.get(tx);
    if (state === undefined) {
      throw new Error(`transaction ${tx} is not active`);
    }
    return state;
  }

  private undef(image: Image): string | undefined {
    return image === null ? undefined : image;
  }

  private pageImage(key: string): Image {
    const buffered = this.buffer.get(key);
    if (buffered !== undefined) {
      return buffered.image;
    }
    return this.disk.get(key)?.image ?? null;
  }

  private apply(key: string, image: Image, lsn: number): void {
    if (!this.dirty.has(key)) {
      this.dirty.set(key, lsn);
    }
    this.buffer.set(key, { lsn, image });
  }

  private recordAt(lsn: number): LogRecord | undefined {
    return this.log[lsn - 1];
  }

  private undoChain(tx: number, startLsn: number): void {
    let lsn = startLsn;
    while (lsn !== 0) {
      const record = this.recordAt(lsn);
      if (record === undefined) {
        break;
      }
      if (record.kind === "clr") {
        const state = this.txns.get(tx);
        if (state !== undefined) {
          state.lastLsn = record.lsn;
        }
        lsn = record.undoNext;
        continue;
      }
      if (record.kind !== "update") {
        break;
      }
      const state = this.txns.get(tx);
      const clrLsn = this.nextLsn();
      this.log.push({
        kind: "clr",
        lsn: clrLsn,
        tx,
        prevLsn: state?.lastLsn ?? 0,
        key: record.key,
        undoNext: record.prevLsn,
        image: record.before,
      });
      if (state !== undefined) {
        state.lastLsn = clrLsn;
      }
      this.apply(record.key, record.before, clrLsn);
      lsn = record.prevLsn;
    }
  }

  private analyze(): { txns: Map<number, TxnState>; dirty: Map<string, number> } {
    const txns = new Map<number, TxnState>();
    const dirty = new Map<string, number>();
    let start = 0;
    for (let i = this.log.length - 1; i >= 0; i--) {
      const checkpoint = this.log[i];
      if (checkpoint.kind === "checkpoint") {
        for (const rawTx of Object.keys(checkpoint.txns)) {
          const tx = Number(rawTx);
          txns.set(tx, { lastLsn: checkpoint.txns[tx], keys: new Set() });
        }
        for (const key of Object.keys(checkpoint.dirty)) {
          dirty.set(key, checkpoint.dirty[key]);
        }
        start = i + 1;
        break;
      }
    }
    for (let i = start; i < this.log.length; i++) {
      const record = this.log[i];
      if (record.kind === "checkpoint") {
        continue;
      }
      if (record.kind === "update" || record.kind === "clr") {
        const state = txns.get(record.tx) ?? { lastLsn: 0, keys: new Set() };
        state.lastLsn = record.lsn;
        txns.set(record.tx, state);
        if (!dirty.has(record.key)) {
          dirty.set(record.key, record.lsn);
        }
      } else if (record.kind === "commit" || record.kind === "abort") {
        txns.delete(record.tx);
      }
    }
    this.txns = txns;
    this.dirty = dirty;
    this.buffer = new Map();
    return { txns, dirty };
  }

  private redo(dirty: Map<string, number>): void {
    let minLsn = Number.POSITIVE_INFINITY;
    for (const recLsn of dirty.values()) {
      if (recLsn < minLsn) {
        minLsn = recLsn;
      }
    }
    const first = minLsn === Number.POSITIVE_INFINITY ? this.log.length : minLsn - 1;
    for (let i = first; i < this.log.length; i++) {
      const record = this.log[i];
      if (record.kind !== "update" && record.kind !== "clr") {
        continue;
      }
      if (!dirty.has(record.key)) {
        continue;
      }
      const onDisk = this.disk.get(record.key);
      if (onDisk !== undefined && onDisk.lsn >= record.lsn) {
        if (!this.buffer.has(record.key)) {
          this.buffer.set(record.key, { lsn: onDisk.lsn, image: onDisk.image });
        }
        continue;
      }
      const image = record.kind === "update" ? record.after : record.image;
      this.apply(record.key, image, record.lsn);
    }
  }

  private undoLosers(txns: Map<number, TxnState>): void {
    for (const [tx, state] of txns) {
      this.undoChain(tx, state.lastLsn);
      const lastLsn = this.txns.get(tx)?.lastLsn ?? state.lastLsn;
      this.log.push({ kind: "abort", lsn: this.nextLsn(), tx, prevLsn: lastLsn });
      this.txns.delete(tx);
    }
  }
}
