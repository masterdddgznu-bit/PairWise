export class WaterLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  available(): number {
    return this.balance;
  }

  grant(amount: number): number {
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
