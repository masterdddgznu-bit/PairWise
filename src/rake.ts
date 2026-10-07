export class RakeGate {
  private engaged = new Set<string>();

  engage(id: string): void {
    this.engaged.add(id);
  }

  disengage(id: string): void {
    this.engaged.delete(id);
  }

  isEngaged(id: string): boolean {
    return this.engaged.has(id);
  }

  clear(id: string): void {
    this.engaged.delete(id);
  }
}
