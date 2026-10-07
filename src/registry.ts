import { CapacityError, InvalidFluxError, InvalidIdError, InvalidSpanError } from "./errors.js";

export interface Batch {
  id: string;
  payload: unknown;
  meltAt: number;
  pourAt: number;
  flux: number;
  seq: number;
  lidded: boolean;
}

export interface BatchSnapshot {
  id: string;
  payload: unknown;
  meltAt: number;
  pourAt: number;
  flux: number;
}

export function snapshotOf(batch: Batch): BatchSnapshot {
  return {
    id: batch.id,
    payload: batch.payload,
    meltAt: batch.meltAt,
    pourAt: batch.pourAt,
    flux: batch.flux,
  };
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(meltAt: unknown, pourAt: unknown): void {
  if (
    typeof meltAt !== "number" ||
    !Number.isInteger(meltAt) ||
    meltAt < 0 ||
    typeof pourAt !== "number" ||
    !Number.isInteger(pourAt) ||
    pourAt < 0 ||
    pourAt <= meltAt
  ) {
    throw new InvalidSpanError("span requires finite integers 0 <= meltAt < pourAt");
  }
}

export function assertValidFlux(flux: unknown): void {
  if (typeof flux !== "number" || !Number.isInteger(flux) || flux < 1) {
    throw new InvalidFluxError("flux must be a finite integer >= 1");
  }
}

/** Registry of batches keyed by id, preserving first-load order via seq. */
export class BatchRegistry {
  private readonly batches = new Map<string, Batch>();
  private nextSeq = 0;

  constructor(private readonly maxBatches: number) {}

  has(id: string): boolean {
    return this.batches.has(id);
  }

  get(id: string): Batch | undefined {
    return this.batches.get(id);
  }

  size(): number {
    return this.batches.size;
  }

  /** Insert or overwrite. Returns "accepted" for new ids, "updated" otherwise. */
  charge(id: string, payload: unknown, meltAt: number, pourAt: number, flux: number): "accepted" | "updated" {
    const existing = this.batches.get(id);
    if (existing) {
      existing.payload = payload;
      existing.meltAt = meltAt;
      existing.pourAt = pourAt;
      existing.flux = flux;
      return "updated";
    }
    if (this.batches.size >= this.maxBatches) {
      throw new CapacityError("kettle is at capacity");
    }
    this.batches.set(id, {
      id,
      payload,
      meltAt,
      pourAt,
      flux,
      seq: this.nextSeq++,
      lidded: false,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.batches.delete(id);
  }

  /** All batches in first-load order. */
  all(): Batch[] {
    return [...this.batches.values()].sort((a, b) => a.seq - b.seq);
  }
}
