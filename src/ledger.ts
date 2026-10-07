import { InvalidAmountError } from "./errors.js";

export class PumpLedger {
  #balance: number;

  constructor(initial: number) {
    this.#balance = initial;
  }

  balance(): number {
    return this.#balance;
  }

  endow(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
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
