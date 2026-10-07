export class BellowsGate {
  private readonly latched = new Set<string>();

  latch(id: string): void {
    this.latched.add(id);
  }

  unlatch(id: string): void {
    this.latched.delete(id);
  }

  isLatched(id: string): boolean {
    return this.latched.has(id);
  }

  clear(id: string): void {
    this.latched.delete(id);
  }
}
