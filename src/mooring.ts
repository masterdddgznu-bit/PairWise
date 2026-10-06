export class MoorGate {
  private readonly untilById = new Map<string, number>();

  moor(id: string, until: number): void {
    this.untilById.set(id, until);
  }

  unmoor(id: string): void {
    this.untilById.delete(id);
  }

  clear(id: string): void {
    this.untilById.delete(id);
  }

  isMoored(id: string, now: number): boolean {
    const until = this.untilById.get(id);
    return until !== undefined && now < until;
  }
}
