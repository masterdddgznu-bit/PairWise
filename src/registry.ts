export interface Nozzle {
  id: string;
  payload: unknown;
  igniteAt: number;
  snuffAt: number;
  wind: number;
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

/**
 * Registration window store. Iteration order is the first-mount order;
 * updating an existing id never changes its position.
 */
export class Registry {
  readonly #nozzles = new Map<string, Nozzle>();

  has(id: string): boolean {
    return this.#nozzles.has(id);
  }

  get(id: string): Nozzle | undefined {
    return this.#nozzles.get(id);
  }

  get size(): number {
    return this.#nozzles.size;
  }

  add(nozzle: Nozzle): void {
    this.#nozzles.set(nozzle.id, nozzle);
  }

  remove(id: string): boolean {
    return this.#nozzles.delete(id);
  }

  ids(): string[] {
    return [...this.#nozzles.keys()];
  }

  entries(): Nozzle[] {
    return [...this.#nozzles.values()];
  }
}
