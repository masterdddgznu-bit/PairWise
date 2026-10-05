import { BudgetError } from "./errors.js";

export class ClaimBudget {
  #credits: number;

  constructor(initialCredits: number) {
    this.#credits = initialCredits;
  }

  credits(): number {
    return this.#credits;
  }

  grant(n: number): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new BudgetError("grant requires a non-negative integer");
    }
    this.#credits += n;
  }

  spend(): void {
    if (this.#credits < 1) {
      throw new BudgetError("insufficient claim credits");
    }
    this.#credits -= 1;
  }
}
