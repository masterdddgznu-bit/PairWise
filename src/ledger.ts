import { InvalidAmountError } from "./errors.js";

export class StrokeLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  credit(): number {
    return this.balance;
  }

  endow(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError(`invalid amount: ${amount}`);
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
