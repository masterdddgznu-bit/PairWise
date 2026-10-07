export class BaffleGate {
  private readonly baffled = new Set<string>();

  baffle(id: string): void {
    this.baffled.add(id);
  }

  unbaffle(id: string): void {
    this.baffled.delete(id);
  }

  isBaffled(id: string): boolean {
    return this.baffled.has(id);
  }

  clear(id: string): void {
    this.baffled.delete(id);
  }
}
