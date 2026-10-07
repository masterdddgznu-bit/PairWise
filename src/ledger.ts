import { InvalidAmountError } from "./errors.js";

export class StrokeLedger {
  private balance: number;

  constructor(initialCredit: number) {
    this.balance = initialCredit;
  }

  credit(): number {
    return this.balance;
  }

  endow(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
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
