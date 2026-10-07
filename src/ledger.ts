import { InvalidAmountError } from "./errors.js";

export class CreditLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  endow(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    this.balance += amount;
    return this.balance;
  }

  credit(): number {
    return this.balance;
  }

  trySpend(): boolean {
    if (this.balance <= 0) {
      return false;
    }
    this.balance -= 1;
    return true;
  }
}
