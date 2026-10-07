export class FlorGate {
  private readonly veiled = new Set<string>();

  veil(id: string): void {
    this.veiled.add(id);
  }

  unveil(id: string): void {
    this.veiled.delete(id);
  }

  isVeiled(id: string): boolean {
    return this.veiled.has(id);
  }

  forget(id: string): void {
    this.veiled.delete(id);
  }
}
