import { InvalidAmountError } from "./errors.js";

export class WaxLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  get wax(): number {
    return this.balance;
  }

  grant(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    this.balance += amount;
    return this.balance;
  }

  spend(cost: number): void {
    this.balance -= cost;
  }
}
