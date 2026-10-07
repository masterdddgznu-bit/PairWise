export class BaffleGate {
  private readonly baffled = new Set<string>();

  set(id: string): void {
    this.baffled.add(id);
  }

  clear(id: string): void {
    this.baffled.delete(id);
  }

  isBaffled(id: string): boolean {
    return this.baffled.has(id);
  }

  forget(id: string): void {
    this.baffled.delete(id);
  }
}
