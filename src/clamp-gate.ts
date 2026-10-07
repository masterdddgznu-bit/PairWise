export class ClampGate {
  private readonly clamped = new Set<string>();

  engage(id: string): void {
    this.clamped.add(id);
  }

  release(id: string): void {
    this.clamped.delete(id);
  }

  isEngaged(id: string): boolean {
    return this.clamped.has(id);
  }

  forget(id: string): void {
    this.clamped.delete(id);
  }
}
