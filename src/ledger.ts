import { InvalidAmountError } from "./errors.js";

export class TineLedger {
  #balance: number;

  constructor(initial: number) {
    this.#balance = initial;
  }

  balance(): number {
    return this.#balance;
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError(`invalid grant amount: ${amount}`);
    }
    this.#balance += amount;
    return this.#balance;
  }

  canAfford(cost: number): boolean {
    return this.#balance >= cost;
  }

  spend(cost: number): void {
    this.#balance -= cost;
  }
}
