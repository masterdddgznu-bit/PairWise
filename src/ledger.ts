export interface Boost {
  boostId: number;
  entryId: string;
  amount: number;
  expiresAt: number;
}

/**
 * Temporary weight boost ledger. boostIds are globally increasing
 * starting from 1. Boosts are only removed by explicit expiry
 * (drive/cleanup) or when their entry is removed; queries never
 * mutate the ledger.
 */
export class BoostLedger {
  private boosts = new Map<number, Boost>();
  private byEntry = new Map<string, number[]>();
  private nextId = 1;

  add(entryId: string, amount: number, expiresAt: number): number {
    const boostId = this.nextId++;
    this.boosts.set(boostId, { boostId, entryId, amount, expiresAt });
    const list = this.byEntry.get(entryId) ?? [];
    list.push(boostId);
    this.byEntry.set(entryId, list);
    return boostId;
  }

  removeForEntry(entryId: string): void {
    const list = this.byEntry.get(entryId);
    if (!list) return;
    for (const boostId of list) {
      this.boosts.delete(boostId);
    }
    this.byEntry.delete(entryId);
  }

  /** Expire all boosts with expiresAt <= now. Returns ids ascending. */
  expire(now: number): number[] {
    const expired: number[] = [];
    for (const boost of this.boosts.values()) {
      if (boost.expiresAt <= now) {
        expired.push(boost.boostId);
      }
    }
    for (const boostId of expired) {
      this.removeOne(boostId);
    }
    return expired.sort((a, b) => a - b);
  }

  activeFor(entryId: string): number[] {
    const list = this.byEntry.get(entryId);
    if (!list) return [];
    return list.filter((id) => this.boosts.has(id)).sort((a, b) => a - b);
  }

  bonusFor(entryId: string): number {
    let total = 0;
    for (const boostId of this.activeFor(entryId)) {
      total += this.boosts.get(boostId)!.amount;
    }
    return total;
  }

  private removeOne(boostId: number): void {
    const boost = this.boosts.get(boostId);
    if (!boost) return;
    this.boosts.delete(boostId);
    const list = this.byEntry.get(boost.entryId);
    if (list) {
      const next = list.filter((id) => id !== boostId);
      if (next.length === 0) {
        this.byEntry.delete(boost.entryId);
      } else {
        this.byEntry.set(boost.entryId, next);
      }
    }
  }
}
