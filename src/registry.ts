import {
  CapacityError,
  InvalidIdError,
  InvalidSpanError,
  InvalidIbuError,
  UnknownIdError,
} from "./errors.js";

export interface Charge {
  id: string;
  payload: unknown;
  steepAt: number;
  dumpAt: number;
  ibu: number;
  seq: number;
  plugged: boolean;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(steepAt: unknown, dumpAt: unknown): void {
  if (
    typeof steepAt !== "number" ||
    typeof dumpAt !== "number" ||
    !Number.isInteger(steepAt) ||
    !Number.isInteger(dumpAt) ||
    steepAt < 0 ||
    dumpAt < 0 ||
    dumpAt <= steepAt
  ) {
    throw new InvalidSpanError(
      "steepAt/dumpAt must be integers >= 0 with dumpAt > steepAt",
    );
  }
}

export function validateIbu(ibu: unknown): void {
  if (typeof ibu !== "number" || !Number.isInteger(ibu) || ibu < 1) {
    throw new InvalidIbuError("ibu must be an integer >= 1");
  }
}

export class Registry {
  private readonly charges = new Map<string, Charge>();
  private nextSeq = 0;

  constructor(private readonly maxCharges: number) {}

  size(): number {
    return this.charges.size;
  }

  get(id: string): Charge | undefined {
    return this.charges.get(id);
  }

  require(id: string): Charge {
    const charge = this.charges.get(id);
    if (!charge) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return charge;
  }

  charge(
    id: string,
    payload: unknown,
    steepAt: number,
    dumpAt: number,
    ibu: number,
  ): "accepted" | "updated" {
    const existing = this.charges.get(id);
    if (existing) {
      existing.payload = payload;
      existing.steepAt = steepAt;
      existing.dumpAt = dumpAt;
      existing.ibu = ibu;
      return "updated";
    }
    if (this.charges.size >= this.maxCharges) {
      throw new CapacityError("hopback is at capacity");
    }
    this.charges.set(id, {
      id,
      payload,
      steepAt,
      dumpAt,
      ibu,
      seq: this.nextSeq++,
      plugged: true,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.charges.delete(id);
  }

  all(): Charge[] {
    return [...this.charges.values()];
  }

  ids(): string[] {
    return [...this.charges.keys()];
  }
}
