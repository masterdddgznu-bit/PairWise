import { InvalidAmountError } from "./errors.js";

export class PigmentLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  available(): number {
    return this.balance;
  }

  grant(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("grant amount must be an integer >= 1");
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
