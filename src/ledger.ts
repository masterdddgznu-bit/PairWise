import { InvalidAmountError } from "./errors.js";

export class CreditLedger {
  private balance: number;

  constructor(initialCredit: number) {
    this.balance = initialCredit;
  }

  credit(): number {
    return this.balance;
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError(`grant amount must be an integer >= 1, got ${amount}`);
    }
    this.balance += amount;
    return this.balance;
  }

  canAfford(cost: number): boolean {
    return cost <= this.balance;
  }

  spend(cost: number): void {
    this.balance -= cost;
  }
}
