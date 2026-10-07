import { InvalidAmountError } from "./errors.js";

export class BlowLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  blows(): number {
    return this.balance;
  }

  endow(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
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
