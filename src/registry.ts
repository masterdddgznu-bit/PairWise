import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Bundle {
  id: string;
  payload: unknown;
  inAt: number;
  outAt: number;
  cost: number;
  seq: number;
  sluiced: boolean;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(inAt: unknown, outAt: unknown): void {
  if (
    typeof inAt !== "number" ||
    !Number.isInteger(inAt) ||
    inAt < 0 ||
    typeof outAt !== "number" ||
    !Number.isInteger(outAt) ||
    outAt < 0 ||
    outAt <= inAt
  ) {
    throw new InvalidSpanError(
      "inAt/outAt must be integers >= 0 with outAt > inAt",
    );
  }
}

export function assertValidCost(cost: unknown): void {
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class Registry {
  private readonly bundles = new Map<string, Bundle>();
  private nextSeq = 0;

  constructor(private readonly maxBundles: number) {}

  get size(): number {
    return this.bundles.size;
  }

  get(id: string): Bundle | undefined {
    return this.bundles.get(id);
  }

  bind(
    id: string,
    payload: unknown,
    inAt: number,
    outAt: number,
    cost: number,
  ): "accepted" | "updated" {
    const existing = this.bundles.get(id);
    if (existing) {
      existing.payload = payload;
      existing.inAt = inAt;
      existing.outAt = outAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.bundles.size >= this.maxBundles) {
      throw new CapacityError("bundle capacity reached");
    }
    this.bundles.set(id, {
      id,
      payload,
      inAt,
      outAt,
      cost,
      seq: this.nextSeq++,
      sluiced: false,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.bundles.delete(id);
  }

  allBySeq(): Bundle[] {
    return [...this.bundles.values()].sort((a, b) => a.seq - b.seq);
  }
}
