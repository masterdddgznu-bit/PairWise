import {
  CapacityError,
  InvalidFluxError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Charge {
  id: string;
  payload: unknown;
  dunkAt: number;
  liftAt: number;
  flux: number;
  seq: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(dunkAt: unknown, liftAt: unknown): void {
  if (
    typeof dunkAt !== "number" ||
    typeof liftAt !== "number" ||
    !Number.isInteger(dunkAt) ||
    !Number.isInteger(liftAt) ||
    dunkAt < 0 ||
    liftAt < 0 ||
    liftAt <= dunkAt
  ) {
    throw new InvalidSpanError(
      "dunkAt/liftAt must be integers >= 0 with liftAt > dunkAt",
    );
  }
}

export function validateFlux(flux: unknown): void {
  if (typeof flux !== "number" || !Number.isInteger(flux) || flux < 1) {
    throw new InvalidFluxError("flux must be an integer >= 1");
  }
}

export class ChargeRegistry {
  private readonly charges = new Map<string, Charge>();
  private nextSeq = 0;

  constructor(private readonly maxCharges: number) {}

  get size(): number {
    return this.charges.size;
  }

  get(id: string): Charge | undefined {
    return this.charges.get(id);
  }

  has(id: string): boolean {
    return this.charges.has(id);
  }

  ids(): string[] {
    return [...this.charges.keys()];
  }

  entries(): Charge[] {
    return [...this.charges.values()];
  }

  store(
    id: string,
    payload: unknown,
    dunkAt: number,
    liftAt: number,
    flux: number,
  ): { status: "accepted" | "updated"; isNew: boolean } {
    validateId(id);
    validateSpan(dunkAt, liftAt);
    validateFlux(flux);
    const existing = this.charges.get(id);
    if (existing) {
      existing.payload = payload;
      existing.dunkAt = dunkAt;
      existing.liftAt = liftAt;
      existing.flux = flux;
      return { status: "updated", isNew: false };
    }
    if (this.charges.size >= this.maxCharges) {
      throw new CapacityError("registry is at capacity");
    }
    this.charges.set(id, {
      id,
      payload,
      dunkAt,
      liftAt,
      flux,
      seq: this.nextSeq++,
    });
    return { status: "accepted", isNew: true };
  }

  retune(id: string, dunkAt: number, liftAt: number): boolean {
    validateId(id);
    validateSpan(dunkAt, liftAt);
    const charge = this.charges.get(id);
    if (!charge) return false;
    charge.dunkAt = dunkAt;
    charge.liftAt = liftAt;
    return true;
  }

  remove(id: string): boolean {
    validateId(id);
    return this.charges.delete(id);
  }
}
