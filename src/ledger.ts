import { InvalidAmountError } from "./errors.js";

export class LiquorLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  grant(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("grant amount must be an integer >= 1");
    }
    this.balance += amount;
    return this.balance;
  }

  available(): number {
    return this.balance;
  }

  canSpend(amount: number): boolean {
    return amount <= this.balance;
  }

  spend(amount: number): void {
    this.balance -= amount;
  }
}
