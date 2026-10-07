/** Belay gate: tracks which registered lines are latched against pulling. */
export class BelayGate {
  private readonly latched = new Set<string>();

  belay(id: string): void {
    this.latched.add(id);
  }

  free(id: string): void {
    this.latched.delete(id);
  }

  isBelayed(id: string): boolean {
    return this.latched.has(id);
  }

  clear(id: string): void {
    this.latched.delete(id);
  }
}
