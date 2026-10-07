import {
  CapacityError,
  InvalidFlowError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Parcel {
  id: string;
  payload: unknown;
  crestAt: number;
  spillAt: number;
  flow: number;
  seq: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(crestAt: unknown, spillAt: unknown): void {
  if (
    !Number.isInteger(crestAt) ||
    !Number.isInteger(spillAt) ||
    (crestAt as number) < 0 ||
    (spillAt as number) < 0 ||
    (spillAt as number) <= (crestAt as number)
  ) {
    throw new InvalidSpanError(
      "crestAt/spillAt must be integers >= 0 with spillAt > crestAt",
    );
  }
}

export function validateFlow(flow: unknown): void {
  if (!Number.isInteger(flow) || (flow as number) < 1) {
    throw new InvalidFlowError("flow must be an integer >= 1");
  }
}

export class ParcelRegistry {
  private parcels = new Map<string, Parcel>();
  private nextSeq = 0;

  constructor(private readonly maxParcels: number) {}

  has(id: string): boolean {
    return this.parcels.has(id);
  }

  get(id: string): Parcel | undefined {
    return this.parcels.get(id);
  }

  admit(
    id: string,
    payload: unknown,
    crestAt: number,
    spillAt: number,
    flow: number,
  ): "accepted" | "updated" {
    const existing = this.parcels.get(id);
    if (existing) {
      existing.payload = payload;
      existing.crestAt = crestAt;
      existing.spillAt = spillAt;
      existing.flow = flow;
      return "updated";
    }
    if (this.parcels.size >= this.maxParcels) {
      throw new CapacityError("registry is at capacity");
    }
    this.parcels.set(id, {
      id,
      payload,
      crestAt,
      spillAt,
      flow,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  retune(id: string, crestAt: number, spillAt: number): boolean {
    const parcel = this.parcels.get(id);
    if (!parcel) {
      return false;
    }
    parcel.crestAt = crestAt;
    parcel.spillAt = spillAt;
    return true;
  }

  remove(id: string): boolean {
    return this.parcels.delete(id);
  }

  ids(): string[] {
    return [...this.parcels.keys()];
  }

  size(): number {
    return this.parcels.size;
  }

  entries(): Parcel[] {
    return [...this.parcels.values()];
  }
}

export function compareParcels(a: Parcel, b: Parcel): number {
  if (a.spillAt !== b.spillAt) return a.spillAt - b.spillAt;
  if (a.flow !== b.flow) return b.flow - a.flow;
  return a.seq - b.seq;
}
