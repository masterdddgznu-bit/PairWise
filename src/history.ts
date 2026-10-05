export class ArrivalLog {
  private readonly byGeneration = new Map<number, string[]>();

  record(generation: number, party: string): void {
    let arrivals = this.byGeneration.get(generation);
    if (arrivals === undefined) {
      arrivals = [];
      this.byGeneration.set(generation, arrivals);
    }
    arrivals.push(party);
  }

  arrivalsIn(generation: number): string[] {
    if (!Number.isInteger(generation) || generation < 1) {
      return [];
    }
    const arrivals = this.byGeneration.get(generation);
    return arrivals === undefined ? [] : [...arrivals];
  }

  wasPresent(party: string, generation: number): boolean {
    if (!Number.isInteger(generation) || generation < 1) {
      return false;
    }
    const arrivals = this.byGeneration.get(generation);
    return arrivals !== undefined && arrivals.includes(party);
  }
}
