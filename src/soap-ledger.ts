import { InvalidAmountError } from "./errors.js";

export class SoapLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  value(): number {
    return this.balance;
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
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
