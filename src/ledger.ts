export class HaulLedger {
  private balance: number;

  constructor(initialCredit: number) {
    this.balance = initialCredit;
  }

  credit(): number {
    return this.balance;
  }

  endow(amount: number): number {
    this.balance += amount;
    return this.balance;
  }

  canAfford(cost: number): boolean {
    return this.balance >= cost;
  }

  spend(cost: number): void {
    this.balance -= cost;
  }
}
