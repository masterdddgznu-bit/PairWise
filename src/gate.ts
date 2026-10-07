export class BelayGate {
  private belayed = new Set<string>();

  belay(id: string): void {
    this.belayed.add(id);
  }

  free(id: string): void {
    this.belayed.delete(id);
  }

  isBelayed(id: string): boolean {
    return this.belayed.has(id);
  }

  clear(id: string): void {
    this.belayed.delete(id);
  }
}
