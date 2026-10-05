export class ArrivalLog {
  private readonly byGeneration = new Map<number, string[]>();

  record(generation: number, party: string): void {
    let entries = this.byGeneration.get(generation);
    if (entries === undefined) {
      entries = [];
      this.byGeneration.set(generation, entries);
    }
    entries.push(party);
  }

  arrivalsIn(generation: number): string[] {
    if (!Number.isInteger(generation) || generation < 1) {
      return [];
    }
    return [...(this.byGeneration.get(generation) ?? [])];
  }

  present(generation: number, party: string): boolean {
    if (!Number.isInteger(generation) || generation < 1) {
      return false;
    }
    return (this.byGeneration.get(generation) ?? []).includes(party);
  }
}
