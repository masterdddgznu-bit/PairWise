export interface Rack {
  id: string;
  payload: unknown;
  chargeAt: number;
  drawAt: number;
  cost: number;
}

export interface RackSnapshot {
  id: string;
  payload: unknown;
  chargeAt: number;
  drawAt: number;
  cost: number;
}

export class RackRegistry {
  private readonly racks = new Map<string, Rack>();

  constructor(private readonly maxRacks: number) {}

  has(id: string): boolean {
    return this.racks.has(id);
  }

  get(id: string): Rack | undefined {
    return this.racks.get(id);
  }

  get size(): number {
    return this.racks.size;
  }

  get isFull(): boolean {
    return this.racks.size >= this.maxRacks;
  }

  add(rack: Rack): void {
    this.racks.set(rack.id, rack);
  }

  remove(id: string): boolean {
    return this.racks.delete(id);
  }

  ids(): string[] {
    return [...this.racks.keys()];
  }

  entries(): Rack[] {
    return [...this.racks.values()];
  }
}

export function snapshotOf(rack: Rack): RackSnapshot {
  return {
    id: rack.id,
    payload: rack.payload,
    chargeAt: rack.chargeAt,
    drawAt: rack.drawAt,
    cost: rack.cost,
  };
}
