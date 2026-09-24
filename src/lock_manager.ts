import type { Clock, HeldLock, LockMode, ResourceId, TxnId, TxnStatus } from "./types.js";

/**
 * 多资源锁管理器。起始实现未完成。
 */
export class LockManager {
  constructor(private readonly clock: Clock) {}

  begin(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  /**
   * 申请锁。立即获得返回 "granted"；进入等待返回 "waiting"。
   * 死锁或超时导致本事务被中止时抛错。
   */
  lock(
    txnId: TxnId,
    resource: ResourceId,
    mode: LockMode,
    timeoutMs?: number,
  ): "granted" | "waiting" {
    throw new Error("not implemented");
  }

  /** 推进时钟后调用，处理超时并尽量授予队首。 */
  tick(): void {
    throw new Error("not implemented");
  }

  commit(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  abort(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  crash(txnId: TxnId): void {
    throw new Error("not implemented");
  }

  status(txnId: TxnId): TxnStatus {
    throw new Error("not implemented");
  }

  held(txnId: TxnId): HeldLock[] {
    throw new Error("not implemented");
  }
}
