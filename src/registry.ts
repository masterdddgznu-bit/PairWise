import { CapacityError } from "./errors.js";

export interface Plot {
  id: string;
  payload: unknown;
  cutAt: number;
  stackAt: number;
  cost: number;
  seq: number;
}

export interface PlotSnapshot {
  id: string;
  payload: unknown;
  cutAt: number;
  stackAt: number;
  cost: number;
}

export function snapshotOf(plot: Plot): PlotSnapshot {
  return {
    id: plot.id,
    payload: plot.payload,
    cutAt: plot.cutAt,
    stackAt: plot.stackAt,
    cost: plot.cost,
  };
}

export class PlotRegistry {
  #plots = new Map<string, Plot>();
  #nextSeq = 0;

  constructor(private readonly maxPlots: number) {}

  get size(): number {
    return this.#plots.size;
  }

  has(id: string): boolean {
    return this.#plots.has(id);
  }

  get(id: string): Plot | undefined {
    return this.#plots.get(id);
  }

  add(id: string, payload: unknown, cutAt: number, stackAt: number, cost: number): Plot {
    if (this.#plots.size >= this.maxPlots) {
      throw new CapacityError(`plot capacity ${this.maxPlots} reached`);
    }
    const plot: Plot = { id, payload, cutAt, stackAt, cost, seq: this.#nextSeq++ };
    this.#plots.set(id, plot);
    return plot;
  }

  remove(id: string): boolean {
    return this.#plots.delete(id);
  }

  inFirstStakeOrder(): Plot[] {
    return [...this.#plots.values()];
  }
}

export function byRank(a: Plot, b: Plot): number {
  if (a.stackAt !== b.stackAt) return b.stackAt - a.stackAt;
  if (a.cost !== b.cost) return a.cost - b.cost;
  return a.seq - b.seq;
}
