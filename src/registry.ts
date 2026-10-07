import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Bundle {
  id: string;
  payload: unknown;
  soakAt: number;
  liftAt: number;
  cost: number;
  seq: number;
}

export interface BundleSnapshot {
  id: string;
  payload: unknown;
  soakAt: number;
  liftAt: number;
  cost: number;
}

export function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertSpan(soakAt: unknown, liftAt: unknown): void {
  const valid = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!valid(soakAt) || !valid(liftAt) || liftAt <= soakAt) {
    throw new InvalidSpanError(
      "soakAt/liftAt must be integers >= 0 with liftAt > soakAt",
    );
  }
}

export function assertCost(cost: unknown): void {
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class BundleRegistry {
  private readonly bundles = new Map<string, Bundle>();
  private nextSeq = 0;

  constructor(private readonly maxBundles: number) {}

  size(): number {
    return this.bundles.size;
  }

  has(id: string): boolean {
    return this.bundles.has(id);
  }

  get(id: string): Bundle | undefined {
    return this.bundles.get(id);
  }

  ids(): string[] {
    return [...this.bundles.keys()];
  }

  all(): Bundle[] {
    return [...this.bundles.values()];
  }

  register(
    id: string,
    payload: unknown,
    soakAt: number,
    liftAt: number,
    cost: number,
  ): "accepted" | "updated" {
    const existing = this.bundles.get(id);
    if (existing) {
      existing.payload = payload;
      existing.soakAt = soakAt;
      existing.liftAt = liftAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.bundles.size >= this.maxBundles) {
      throw new CapacityError("bundle capacity reached");
    }
    this.bundles.set(id, {
      id,
      payload,
      soakAt,
      liftAt,
      cost,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): Bundle | undefined {
    const bundle = this.bundles.get(id);
    if (bundle) {
      this.bundles.delete(id);
    }
    return bundle;
  }
}

export function snapshotOf(bundle: Bundle): BundleSnapshot {
  return {
    id: bundle.id,
    payload: bundle.payload,
    soakAt: bundle.soakAt,
    liftAt: bundle.liftAt,
    cost: bundle.cost,
  };
}
