import { CapacityError } from "./errors.js";

export interface Rack {
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

  size(): number {
    return this.racks.size;
  }

  ids(): string[] {
    return [...this.racks.keys()];
  }

  register(rack: Rack): "accepted" | "updated" {
    const existing = this.racks.get(rack.id);
    if (existing) {
      existing.payload = rack.payload;
      existing.chargeAt = rack.chargeAt;
      existing.drawAt = rack.drawAt;
      existing.cost = rack.cost;
      return "updated";
    }
    if (this.racks.size >= this.maxRacks) {
      throw new CapacityError(`rack capacity ${this.maxRacks} reached`);
    }
    this.racks.set(rack.id, { ...rack });
    return "accepted";
  }

  respawn(id: string, chargeAt: number, drawAt: number): boolean {
    const rack = this.racks.get(id);
    if (!rack) return false;
    rack.chargeAt = chargeAt;
    rack.drawAt = drawAt;
    return true;
  }

  remove(id: string): Rack | undefined {
    const rack = this.racks.get(id);
    if (rack) this.racks.delete(id);
    return rack;
  }
}
