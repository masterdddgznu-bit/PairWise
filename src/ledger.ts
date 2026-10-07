import { InvalidAmountError } from "./errors.js";

export class CharLedger {
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

  canAfford(cost: number): boolean {
    return this.balance >= cost;
  }

  spend(cost: number): void {
    this.balance -= cost;
  }
}
