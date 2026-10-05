export class DebtLedger {
  private balance = 0;

  value(): number {
    return this.balance;
  }

  incur(points = 1): void {
    this.balance += points;
  }

  heal(maxPoints: number): number {
    const healed = Math.min(this.balance, maxPoints);
    this.balance -= healed;
    return healed;
  }
}
