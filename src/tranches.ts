export interface Tranche {
  amount: number;
  deadline: number;
}

export interface SweepResult {
  amount: number;
  count: number;
}

export class TrancheLedger {
  private entries: Tranche[] = [];

  append(amount: number, deadline: number): void {
    this.entries.push({ amount, deadline });
  }

  private isLive(tranche: Tranche, now: number): boolean {
    return now < tranche.deadline;
  }

  balance(now: number): number {
    let total = 0;
    for (const tranche of this.entries) {
      if (this.isLive(tranche, now)) {
        total += tranche.amount;
      }
    }
    return total;
  }

  sweepExpired(now: number): SweepResult {
    let amount = 0;
    let count = 0;
    this.entries = this.entries.filter((tranche) => {
      if (this.isLive(tranche, now)) {
        return true;
      }
      amount += tranche.amount;
      count += 1;
      return false;
    });
    return { amount, count };
  }

  consume(amount: number): void {
    let remaining = amount;
    while (remaining > 0 && this.entries.length > 0) {
      const head = this.entries[0];
      const take = Math.min(head.amount, remaining);
      head.amount -= take;
      remaining -= take;
      if (head.amount === 0) {
        this.entries.shift();
      }
    }
  }

  list(): Tranche[] {
    return this.entries.map((tranche) => ({ ...tranche }));
  }

  size(): number {
    return this.entries.length;
  }
}
