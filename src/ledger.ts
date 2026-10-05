export interface BoostRecord {
  boostId: number;
  id: string;
  amount: number;
  expiresAt: number;
}

/**
 * Temporary boost ledger. Boosts stay in the ledger until a mutation/drive
 * expires them by time or removes them together with their entry; queries
 * never mutate the ledger.
 */
export class BoostLedger {
  private readonly boosts = new Map<number, BoostRecord>();
  private nextId = 1;

  add(id: string, amount: number, expiresAt: number): BoostRecord {
    const record: BoostRecord = { boostId: this.nextId, id, amount, expiresAt };
    this.nextId += 1;
    this.boosts.set(record.boostId, record);
    return record;
  }

  removeForId(id: string): void {
    for (const [boostId, record] of this.boosts) {
      if (record.id === id) this.boosts.delete(boostId);
    }
  }

  /** Sum of not-yet-expired boost amounts for id (time-aware). */
  activeAmountFor(id: string, now: number): number {
    let total = 0;
    for (const record of this.boosts.values()) {
      if (record.id === id && record.expiresAt > now) total += record.amount;
    }
    return total;
  }

  /** Sum of all boost amounts still in the ledger for id (time-agnostic). */
  ledgerAmountFor(id: string): number {
    let total = 0;
    for (const record of this.boosts.values()) {
      if (record.id === id) total += record.amount;
    }
    return total;
  }

  boostIdsFor(id: string): number[] {
    const ids: number[] = [];
    for (const [boostId, record] of this.boosts) {
      if (record.id === id) ids.push(boostId);
    }
    return ids;
  }

  /** Expire boosts with expiresAt <= now; returns expired boostIds ascending. */
  expire(now: number): number[] {
    const expired: number[] = [];
    for (const [boostId, record] of this.boosts) {
      if (record.expiresAt <= now) {
        this.boosts.delete(boostId);
        expired.push(boostId);
      }
    }
    return expired.sort((a, b) => a - b);
  }
}
