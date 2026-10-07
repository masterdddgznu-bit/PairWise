export class LidGate {
  private readonly lidded = new Set<string>();

  lid(id: string): void {
    this.lidded.add(id);
  }

  unlid(id: string): void {
    this.lidded.delete(id);
  }

  isLidded(id: string): boolean {
    return this.lidded.has(id);
  }

  clear(id: string): void {
    this.lidded.delete(id);
  }
}
