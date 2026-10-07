export interface Plot {
  id: string;
  payload: unknown;
  cutAt: number;
  stackAt: number;
  cost: number;
  seq: number;
}

export class PlotRegistry {
  private readonly plots = new Map<string, Plot>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.plots.has(id);
  }

  get(id: string): Plot | undefined {
    return this.plots.get(id);
  }

  get size(): number {
    return this.plots.size;
  }

  add(
    id: string,
    payload: unknown,
    cutAt: number,
    stackAt: number,
    cost: number,
  ): Plot {
    const plot: Plot = { id, payload, cutAt, stackAt, cost, seq: this.nextSeq++ };
    this.plots.set(id, plot);
    return plot;
  }

  remove(id: string): boolean {
    return this.plots.delete(id);
  }

  ids(): string[] {
    return [...this.plots.keys()];
  }

  entries(): Plot[] {
    return [...this.plots.values()];
  }
}
