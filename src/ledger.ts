export class CreditLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  credit(): number {
    return this.balance;
  }

  fund(amount: number): number {
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
