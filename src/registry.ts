export interface BundleRecord {
  id: string;
  payload: unknown;
  soakAt: number;
  liftAt: number;
  cost: number;
}

interface Ranked {
  liftAt: number;
  cost: number;
  seq: number;
}

export interface Entry extends BundleRecord, Ranked {
  corked: boolean;
}

export function compareRank(a: Ranked, b: Ranked): number {
  if (a.liftAt !== b.liftAt) return b.liftAt - a.liftAt;
  if (a.cost !== b.cost) return a.cost - b.cost;
  return a.seq - b.seq;
}

export function snapshotOf(entry: BundleRecord): BundleRecord {
  return {
    id: entry.id,
    payload: entry.payload,
    soakAt: entry.soakAt,
    liftAt: entry.liftAt,
    cost: entry.cost,
  };
}

export class BundleRegistry {
  private entries = new Map<string, Entry>();
  private nextSeq = 0;

  size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): BundleRecord | null {
    const entry = this.entries.get(id);
    return entry ? snapshotOf(entry) : null;
  }

  add(id: string, payload: unknown, soakAt: number, liftAt: number, cost: number): void {
    this.entries.set(id, {
      id,
      payload,
      soakAt,
      liftAt,
      cost,
      seq: this.nextSeq++,
      corked: true,
    });
  }

  update(id: string, payload: unknown, soakAt: number, liftAt: number, cost: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.payload = payload;
    entry.soakAt = soakAt;
    entry.liftAt = liftAt;
    entry.cost = cost;
  }

  respan(id: string, soakAt: number, liftAt: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.soakAt = soakAt;
    entry.liftAt = liftAt;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  isCorked(id: string): boolean | null {
    const entry = this.entries.get(id);
    return entry ? entry.corked : null;
  }

  setCorked(id: string, corked: boolean): void {
    const entry = this.entries.get(id);
    if (entry) entry.corked = corked;
  }

  /** All entries in first-registration order. */
  all(): Entry[] {
    return [...this.entries.values()].sort((a, b) => a.seq - b.seq);
  }

  /** Uncorked entries inside their soak window, in retrieval rank order. */
  ripeEntries(now: number): Entry[] {
    return this.all()
      .filter((entry) => !entry.corked && entry.soakAt < now && now <= entry.liftAt)
      .sort(compareRank);
  }

  /** Uncorked entries past their window, in first-registration order. */
  spoiledEntries(now: number): Entry[] {
    return this.all().filter((entry) => !entry.corked && now > entry.liftAt);
  }
}
