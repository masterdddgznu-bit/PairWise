export class FuelLedger {
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

  spend(amount: number): void {
    this.balance -= amount;
  }
}
