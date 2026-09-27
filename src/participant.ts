import type { Vote } from "./types.js";

/** Resource participant — stub. */
export class Participant {
  readonly id: number;
  private data = new Map<string, string>();
  private locks = new Map<string, string>();
  private pending = new Map<string, Map<string, string>>();

  constructor(id: number) {
    this.id = id;
  }

  prepare(txId: string, key: string, value: string): Vote {
    const holder = this.locks.get(key);
    if (holder !== undefined && holder !== txId) return "no";
    this.locks.set(key, txId);
    let writes = this.pending.get(txId);
    if (!writes) {
      writes = new Map();
      this.pending.set(txId, writes);
    }
    writes.set(key, value);
    return "yes";
  }

  commit(txId: string): void {
    const writes = this.pending.get(txId);
    if (writes) {
      for (const [key, value] of writes) this.data.set(key, value);
    }
    this.release(txId);
  }

  abort(txId: string): void {
    this.release(txId);
  }

  /** Abort even if coordinator lost state. */
  forceAbort(txId: string): void {
    this.release(txId);
  }

  read(key: string): string | undefined {
    return this.data.get(key);
  }

  inDoubtTxIds(): string[] {
    return [...this.pending.keys()];
  }

  private release(txId: string): void {
    this.pending.delete(txId);
    for (const [key, holder] of this.locks) {
      if (holder === txId) this.locks.delete(key);
    }
  }
}
