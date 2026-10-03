export type NodeCounters = {
  soft: number;
  hard: number;
  committed: number;
  reserved: number;
};

export class BucketStore {
  private readonly map = new Map<string, NodeCounters>();

  init(id: string, soft: number, hard: number): void {
    this.map.set(id, { soft, hard, committed: 0, reserved: 0 });
  }

  get(id: string): NodeCounters {
    const c = this.map.get(id);
    if (!c) throw new Error(`missing ${id}`);
    return c;
  }

  load(id: string): number {
    const c = this.get(id);
    return c.committed + c.reserved;
  }

  headroom(id: string): number {
    const c = this.get(id);
    return c.hard - c.committed - c.reserved;
  }

  addReserved(id: string, amount: number): void {
    this.get(id).reserved += amount;
  }

  subReserved(id: string, amount: number): void {
    const c = this.get(id);
    c.reserved -= amount;
    if (c.reserved < 0) c.reserved = 0;
  }

  addCommitted(id: string, amount: number): void {
    const c = this.get(id);
    c.committed += amount;
  }

  overSoft(id: string): boolean {
    const c = this.get(id);
    return c.committed + c.reserved > c.soft;
  }
}
