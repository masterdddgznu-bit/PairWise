export class AffinityMap {
  private readonly map = new Map<string, number>();

  get(holder: string): number | null {
    const slot = this.map.get(holder);
    return slot === undefined ? null : slot;
  }

  set(holder: string, slot: number): void {
    this.map.set(holder, slot);
  }

  clear(holder: string): boolean {
    return this.map.delete(holder);
  }
}
