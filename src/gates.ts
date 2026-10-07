export class GateKeeper {
  private readonly gated = new Set<string>();

  gate(id: string): void {
    this.gated.add(id);
  }

  ungate(id: string): void {
    this.gated.delete(id);
  }

  isGated(id: string): boolean {
    return this.gated.has(id);
  }

  clear(id: string): void {
    this.gated.delete(id);
  }
}
