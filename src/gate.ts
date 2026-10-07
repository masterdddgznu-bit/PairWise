export class GateKeeper {
  private latched = new Set<string>();

  latch(id: string): void {
    this.latched.add(id);
  }

  unlatch(id: string): void {
    this.latched.delete(id);
  }

  isLatched(id: string): boolean {
    return this.latched.has(id);
  }

  forget(id: string): void {
    this.latched.delete(id);
  }
}
