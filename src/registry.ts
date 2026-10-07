export interface Nozzle {
  id: string;
  payload: unknown;
  igniteAt: number;
  snuffAt: number;
  wind: number;
  seq: number;
}

export interface NozzleSnapshot {
  id: string;
  payload: unknown;
  igniteAt: number;
  snuffAt: number;
  wind: number;
}

export function snapshotOf(nozzle: Nozzle): NozzleSnapshot {
  return {
    id: nozzle.id,
    payload: nozzle.payload,
    igniteAt: nozzle.igniteAt,
    snuffAt: nozzle.snuffAt,
    wind: nozzle.wind,
  };
}

/** Registration window table: keeps nozzles in first-mount order. */
export class Registry {
  private readonly nozzles = new Map<string, Nozzle>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.nozzles.has(id);
  }

  get(id: string): Nozzle | undefined {
    return this.nozzles.get(id);
  }

  get size(): number {
    return this.nozzles.size;
  }

  add(
    id: string,
    payload: unknown,
    igniteAt: number,
    snuffAt: number,
    wind: number,
  ): Nozzle {
    const nozzle: Nozzle = {
      id,
      payload,
      igniteAt,
      snuffAt,
      wind,
      seq: this.nextSeq++,
    };
    this.nozzles.set(id, nozzle);
    return nozzle;
  }

  remove(id: string): boolean {
    return this.nozzles.delete(id);
  }

  /** All registered nozzles in first-mount order. */
  all(): Nozzle[] {
    return [...this.nozzles.values()];
  }

  ids(): string[] {
    return [...this.nozzles.keys()];
  }
}
