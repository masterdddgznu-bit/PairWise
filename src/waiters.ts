import type { LockMode } from "./types.js";

export type Waiter = {
  txn: string;
  resource: string;
  mode: LockMode;
  expireAt: number | null;
};

/** Starter stub. */
export class WaitQueue {
  enqueue(_w: Waiter): void {
    throw new Error("wait queue not implemented");
  }

  removeTxn(_txn: string): void {}

  removeExpired(_now: number): Waiter[] {
    return [];
  }

  queueOf(_resource: string): Waiter[] {
    return [];
  }

  findTxn(_txn: string): Waiter | undefined {
    return undefined;
  }
}
