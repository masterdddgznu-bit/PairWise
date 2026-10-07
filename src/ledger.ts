export class SodaLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  grant(amount: number): number {
    this.balance += amount;
    return this.balance;
  }

  canAfford(cost: number): boolean {
    return cost <= this.balance;
  }

  spend(cost: number): void {
    this.balance -= cost;
  }

  soda(): number {
    return this.balance;
  }
}
