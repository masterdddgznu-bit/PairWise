export interface Bolt {
  id: string;
  payload: unknown;
  millAt: number;
  beatAt: number;
  soap: number;
  pegged: boolean;
  seq: number;
}

export interface BoltSnapshot {
  id: string;
  payload: unknown;
  millAt: number;
  beatAt: number;
  soap: number;
}

export function snapshotOf(bolt: Bolt): BoltSnapshot {
  return {
    id: bolt.id,
    payload: bolt.payload,
    millAt: bolt.millAt,
    beatAt: bolt.beatAt,
    soap: bolt.soap,
  };
}

export class Registry {
  private bolts = new Map<string, Bolt>();
  private nextSeq = 0;

  constructor(private readonly maxBolts: number) {}

  get size(): number {
    return this.bolts.size;
  }

  has(id: string): boolean {
    return this.bolts.has(id);
  }

  get(id: string): Bolt | undefined {
    return this.bolts.get(id);
  }

  hasCapacityForNew(): boolean {
    return this.bolts.size < this.maxBolts;
  }

  add(id: string, payload: unknown, millAt: number, beatAt: number, soap: number): Bolt {
    const bolt: Bolt = {
      id,
      payload,
      millAt,
      beatAt,
      soap,
      pegged: false,
      seq: this.nextSeq++,
    };
    this.bolts.set(id, bolt);
    return bolt;
  }

  remove(id: string): boolean {
    return this.bolts.delete(id);
  }

  inStoreOrder(): Bolt[] {
    return [...this.bolts.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function isRipe(bolt: Bolt, now: number): boolean {
  return bolt.millAt < now && now <= bolt.beatAt;
}

export function isSpent(bolt: Bolt, now: number): boolean {
  return now > bolt.beatAt;
}

export function compareMillRank(a: Bolt, b: Bolt): number {
  if (a.millAt !== b.millAt) return b.millAt - a.millAt;
  if (a.soap !== b.soap) return b.soap - a.soap;
  return a.seq - b.seq;
}
