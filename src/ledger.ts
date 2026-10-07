import { InvalidAmountError } from "./errors.js";

export class FlowLedger {
  private balance: number;

  constructor(initial: number) {
    this.balance = initial;
  }

  credit(): number {
    return this.balance;
  }

  endow(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    this.balance += amount;
    return this.balance;
  }

  canAfford(flow: number): boolean {
    return this.balance >= flow;
  }

  spend(flow: number): void {
    this.balance -= flow;
  }
}
