export class CorkGate {
  private readonly corked = new Set<string>();

  cork(id: string): void {
    this.corked.add(id);
  }

  uncork(id: string): void {
    this.corked.delete(id);
  }

  isCorked(id: string): boolean {
    return this.corked.has(id);
  }

  forget(id: string): void {
    this.corked.delete(id);
  }
}
