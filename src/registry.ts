export interface Bundle {
  id: string;
  payload: unknown;
  inAt: number;
  outAt: number;
  cost: number;
  seq: number;
  sluiced: boolean;
}

export class Registry {
  private bundles = new Map<string, Bundle>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.bundles.has(id);
  }

  get(id: string): Bundle | undefined {
    return this.bundles.get(id);
  }

  size(): number {
    return this.bundles.size;
  }

  add(
    id: string,
    payload: unknown,
    inAt: number,
    outAt: number,
    cost: number,
  ): Bundle {
    const bundle: Bundle = {
      id,
      payload,
      inAt,
      outAt,
      cost,
      seq: this.nextSeq++,
      sluiced: false,
    };
    this.bundles.set(id, bundle);
    return bundle;
  }

  remove(id: string): boolean {
    return this.bundles.delete(id);
  }

  /** All registered bundles in first-bind order. */
  all(): Bundle[] {
    return [...this.bundles.values()].sort((a, b) => a.seq - b.seq);
  }

  /** Ripe, unsluiced candidates ranked by earlier outAt, higher cost, seq. */
  ranked(now: number): Bundle[] {
    return this.all()
      .filter((b) => !b.sluiced && b.inAt <= now && now < b.outAt)
      .sort(compareRank);
  }
}

export function compareRank(a: Bundle, b: Bundle): number {
  if (a.outAt !== b.outAt) return a.outAt - b.outAt;
  if (a.cost !== b.cost) return b.cost - a.cost;
  return a.seq - b.seq;
}
