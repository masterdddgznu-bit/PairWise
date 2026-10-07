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

export class BoltRegistry {
  private bolts = new Map<string, Bolt>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.bolts.has(id);
  }

  get(id: string): Bolt | undefined {
    return this.bolts.get(id);
  }

  size(): number {
    return this.bolts.size;
  }

  insert(
    id: string,
    payload: unknown,
    millAt: number,
    beatAt: number,
    soap: number,
  ): Bolt {
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

  update(
    bolt: Bolt,
    payload: unknown,
    millAt: number,
    beatAt: number,
    soap: number,
  ): void {
    bolt.payload = payload;
    bolt.millAt = millAt;
    bolt.beatAt = beatAt;
    bolt.soap = soap;
    bolt.pegged = false;
  }

  remill(bolt: Bolt, millAt: number, beatAt: number): void {
    bolt.millAt = millAt;
    bolt.beatAt = beatAt;
    bolt.pegged = true;
  }

  remove(id: string): boolean {
    return this.bolts.delete(id);
  }

  inFirstStoreOrder(): Bolt[] {
    return [...this.bolts.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function isInWindow(bolt: Bolt, now: number): boolean {
  return bolt.millAt < now && now <= bolt.beatAt;
}

export function isSpent(bolt: Bolt, now: number): boolean {
  return now > bolt.beatAt;
}

export function compareCandidates(a: Bolt, b: Bolt): number {
  if (a.millAt !== b.millAt) return b.millAt - a.millAt;
  if (a.soap !== b.soap) return b.soap - a.soap;
  return a.seq - b.seq;
}
