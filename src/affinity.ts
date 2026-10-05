export class AffinityMap {
  private readonly map = new Map<string, number>();

  get(holder: string): number | null {
    const v = this.map.get(holder);
    return v === undefined ? null : v;
  }

  set(holder: string, slot: number): void {
    this.map.set(holder, slot);
  }

  clear(holder: string): boolean {
    return this.map.delete(holder);
  }
}
