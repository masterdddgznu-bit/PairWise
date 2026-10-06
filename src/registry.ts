export interface HideRecord {
  id: string;
  payload: unknown;
  soakAt: number;
  drainAt: number;
  cost: number;
  seq: number;
}

export class HideRegistry {
  private readonly hides = new Map<string, HideRecord>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.hides.has(id);
  }

  get(id: string): HideRecord | undefined {
    return this.hides.get(id);
  }

  add(id: string, payload: unknown, soakAt: number, drainAt: number, cost: number): void {
    this.hides.set(id, { id, payload, soakAt, drainAt, cost, seq: this.nextSeq++ });
  }

  update(id: string, payload: unknown, soakAt: number, drainAt: number, cost: number): void {
    const rec = this.hides.get(id);
    if (!rec) return;
    rec.payload = payload;
    rec.soakAt = soakAt;
    rec.drainAt = drainAt;
    rec.cost = cost;
  }

  resoak(id: string, soakAt: number, drainAt: number): void {
    const rec = this.hides.get(id);
    if (!rec) return;
    rec.soakAt = soakAt;
    rec.drainAt = drainAt;
  }

  remove(id: string): void {
    this.hides.delete(id);
  }

  size(): number {
    return this.hides.size;
  }

  ids(): string[] {
    return [...this.hides.keys()];
  }

  inFirstLoadOrder(): HideRecord[] {
    return [...this.hides.values()];
  }
}
