export interface Pan {
  id: string;
  payload: unknown;
  dropAt: number;
  rackAt: number;
  gravity: number;
}

export interface PanSnapshot {
  id: string;
  payload: unknown;
  dropAt: number;
  rackAt: number;
  gravity: number;
}

interface Entry {
  pan: Pan;
  foamed: boolean;
}

export class PanRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxPans: number) {}

  size(): number {
    return this.entries.size;
  }

  isFull(): boolean {
    return this.entries.size >= this.maxPans;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): Pan | undefined {
    return this.entries.get(id)?.pan;
  }

  register(pan: Pan): void {
    this.entries.set(pan.id, { pan, foamed: true });
  }

  update(pan: Pan): void {
    const entry = this.entries.get(pan.id);
    if (entry) {
      entry.pan = pan;
    }
  }

  remove(id: string): Pan | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(id);
    return entry.pan;
  }

  isFoamed(id: string): boolean | undefined {
    return this.entries.get(id)?.foamed;
  }

  setFoamed(id: string, foamed: boolean): void {
    const entry = this.entries.get(id);
    if (entry) {
      entry.foamed = foamed;
    }
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  all(): Array<{ pan: Pan; foamed: boolean }> {
    return [...this.entries.values()].map((entry) => ({
      pan: entry.pan,
      foamed: entry.foamed,
    }));
  }
}

export function isCooling(pan: Pan, now: number): boolean {
  return pan.dropAt < now && now <= pan.rackAt;
}

export function isSoured(pan: Pan, now: number): boolean {
  return now > pan.rackAt;
}

export function comparePans(a: Pan, b: Pan, seqOf: (id: string) => number): number {
  if (a.rackAt !== b.rackAt) {
    return a.rackAt - b.rackAt;
  }
  if (a.gravity !== b.gravity) {
    return b.gravity - a.gravity;
  }
  return seqOf(a.id) - seqOf(b.id);
}

export function snapshotOf(pan: Pan): PanSnapshot {
  return {
    id: pan.id,
    payload: pan.payload,
    dropAt: pan.dropAt,
    rackAt: pan.rackAt,
    gravity: pan.gravity,
  };
}
