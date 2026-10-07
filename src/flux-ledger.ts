import { InvalidAmountError } from "./errors.js";

export class FluxLedger {
  #balance: number;

  constructor(initial: number) {
    this.#balance = initial;
  }

  balance(): number {
    return this.#balance;
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("grant amount must be an integer >= 1");
    }
    this.#balance += amount;
    return this.#balance;
  }

  trySpend(amount: number): boolean {
    if (amount > this.#balance) {
      return false;
    }
    this.#balance -= amount;
    return true;
  }
}
