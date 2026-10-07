export class ChokeGate {
  private readonly choked = new Set<string>();

  choke(id: string): void {
    this.choked.add(id);
  }

  unchoke(id: string): void {
    this.choked.delete(id);
  }

  isChoked(id: string): boolean {
    return this.choked.has(id);
  }

  clear(id: string): void {
    this.choked.delete(id);
  }
}
