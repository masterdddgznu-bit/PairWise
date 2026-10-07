import { InvalidAmountError } from "./errors.js";

export class LyeLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  lye(): number {
    return this.balance;
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError(`grant requires an integer >= 1, got ${amount}`);
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
