import type { Vote } from "./types.js";

/**
 * Resource participant.
 *
 * Committed key/values are only visible after `commit`. A successful
 * `prepare` records the write as in-doubt and locks the key until the
 * transaction commits or aborts.
 */
export class Participant {
  readonly id: number;
  private readonly committed = new Map<string, string>();
  private readonly inDoubt = new Map<string, Map<string, string>>();

  constructor(id: number) {
    this.id = id;
  }

  prepare(txId: string, key: string, value: string): Vote {
    for (const [otherTxId, pending] of this.inDoubt) {
      if (otherTxId !== txId && pending.has(key)) {
        return "no";
      }
    }
    let pending = this.inDoubt.get(txId);
    if (!pending) {
      pending = new Map<string, string>();
      this.inDoubt.set(txId, pending);
    }
    pending.set(key, value);
    return "yes";
  }

  commit(txId: string): void {
    const pending = this.inDoubt.get(txId);
    if (!pending) {
      return;
    }
    for (const [key, value] of pending) {
      this.committed.set(key, value);
    }
    this.inDoubt.delete(txId);
  }

  abort(txId: string): void {
    this.inDoubt.delete(txId);
  }

  /** Abort even if coordinator lost state. */
  forceAbort(txId: string): void {
    this.inDoubt.delete(txId);
  }

  read(key: string): string | undefined {
    return this.committed.get(key);
  }

  inDoubtTxIds(): string[] {
    return [...this.inDoubt.keys()];
  }
}
