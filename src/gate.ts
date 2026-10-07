export class GateKeeper {
  private readonly vented = new Set<string>();

  vent(id: string): void {
    this.vented.add(id);
  }

  unvent(id: string): void {
    this.vented.delete(id);
  }

  isVented(id: string): boolean {
    return this.vented.has(id);
  }

  clear(id: string): void {
    this.vented.delete(id);
  }
}
