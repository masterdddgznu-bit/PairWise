export class CoverGate {
  private covered = new Set<string>();

  cover(id: string): void {
    this.covered.add(id);
  }

  uncover(id: string): void {
    this.covered.delete(id);
  }

  isCovered(id: string): boolean {
    return this.covered.has(id);
  }

  clear(id: string): void {
    this.covered.delete(id);
  }
}
