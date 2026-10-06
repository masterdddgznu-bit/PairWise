import { InvalidAmountError } from "./errors.js";

export class Purse {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  available(): number {
    return this.balance;
  }

  canAfford(toll: number): boolean {
    return toll <= this.balance;
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("grant amount must be an integer >= 1");
    }
    this.balance += amount;
    return this.balance;
  }

  charge(toll: number): void {
    this.balance -= toll;
  }
}
