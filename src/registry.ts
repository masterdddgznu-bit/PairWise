import {
  CapacityError,
  InvalidFlowError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface Parcel {
  id: string;
  payload: unknown;
  crestAt: number;
  spillAt: number;
  flow: number;
  latched: boolean;
  seq: number;
}

export interface ParcelSnapshot {
  id: string;
  payload: unknown;
  crestAt: number;
  spillAt: number;
  flow: number;
}

export function snapshotOf(parcel: Parcel): ParcelSnapshot {
  return {
    id: parcel.id,
    payload: parcel.payload,
    crestAt: parcel.crestAt,
    spillAt: parcel.spillAt,
    flow: parcel.flow,
  };
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

export class Registry {
  private parcels = new Map<string, Parcel>();
  private nextSeq = 0;

  constructor(private readonly maxParcels: number) {}

  has(id: string): boolean {
    return this.parcels.has(id);
  }

  get(id: string): Parcel | undefined {
    return this.parcels.get(id);
  }

  require(id: string): Parcel {
    const parcel = this.parcels.get(id);
    if (!parcel) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return parcel;
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
      throw new CapacityError("parcel capacity reached");
    }
    this.parcels.set(id, {
      id,
      payload,
      crestAt,
      spillAt,
      flow,
      latched: true,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.parcels.delete(id);
  }

  size(): number {
    return this.parcels.size;
  }

  inAdmitOrder(): Parcel[] {
    return [...this.parcels.values()].sort((a, b) => a.seq - b.seq);
  }
}
