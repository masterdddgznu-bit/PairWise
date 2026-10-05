export class DebtLedger {
  private value = 0;

  current(): number {
    return this.value;
  }

  penalize(points: number): void {
    this.value += points;
  }

  heal(limit: number): number {
    const healed = Math.min(this.value, limit);
    this.value -= healed;
    return healed;
  }
}
