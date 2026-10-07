export class CreditLedger {
  #balance: number;

  constructor(initial: number) {
    this.#balance = initial;
  }

  balance(): number {
    return this.#balance;
  }

  endow(amount: number): number {
    this.#balance += amount;
    return this.#balance;
  }

  affordable(cost: number): boolean {
    return cost <= this.#balance;
  }

  spend(cost: number): void {
    this.#balance -= cost;
  }
}
