export class ClampGate {
  private readonly clamped = new Set<string>();

  clamp(id: string): void {
    this.clamped.add(id);
  }

  unclamp(id: string): void {
    this.clamped.delete(id);
  }

  isClamped(id: string): boolean {
    return this.clamped.has(id);
  }

  forget(id: string): void {
    this.clamped.delete(id);
  }
}
