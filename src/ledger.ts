export interface Tranche {
  amount: number;
  deadline: number;
}

export class TrancheLedger {
  private tranches: Tranche[] = [];

  size(): number {
    return this.tranches.length;
  }

  all(): Tranche[] {
    return this.tranches.map((t) => ({ amount: t.amount, deadline: t.deadline }));
  }

  liveBalance(now: number): number {
    let sum = 0;
    for (const t of this.tranches) {
      if (now < t.deadline) sum += t.amount;
    }
    return sum;
  }

  append(amount: number, deadline: number): void {
    this.tranches.push({ amount, deadline });
  }

  sweepExpired(now: number): { amount: number; count: number } {
    let amount = 0;
    let count = 0;
    this.tranches = this.tranches.filter((t) => {
      if (now < t.deadline) return true;
      amount += t.amount;
      count += 1;
      return false;
    });
    return { amount, count };
  }

  deduct(amount: number): void {
    let remaining = amount;
    while (remaining > 0) {
      const head = this.tranches[0];
      if (head === undefined) {
        throw new Error("insufficient tranche balance for deduction");
      }
      const take = Math.min(head.amount, remaining);
      head.amount -= take;
      remaining -= take;
      if (head.amount === 0) this.tranches.shift();
    }
  }
}
