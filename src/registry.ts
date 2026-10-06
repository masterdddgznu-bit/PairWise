import {
  CapacityError,
  InvalidHoldError,
  InvalidIdError,
  InvalidTollError,
  InvalidWeightError,
} from "./errors.js";

export interface Crate {
  id: string;
  payload: unknown;
  ripeAt: number;
  rotAt: number;
  weight: number;
  toll: number;
  seq: number;
}

export interface CrateSnapshot {
  id: string;
  payload: unknown;
  ripeAt: number;
  rotAt: number;
  weight: number;
  toll: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateHold(ripeAt: number, rotAt: number): void {
  if (
    !Number.isInteger(ripeAt) ||
    !Number.isInteger(rotAt) ||
    ripeAt < 0 ||
    rotAt < 0 ||
    rotAt <= ripeAt
  ) {
    throw new InvalidHoldError("hold requires integer 0 <= ripeAt < rotAt");
  }
}

export function validateWeight(weight: number): void {
  if (!Number.isInteger(weight) || weight < 1) {
    throw new InvalidWeightError("weight must be an integer >= 1");
  }
}

export function validateToll(toll: number): void {
  if (!Number.isInteger(toll) || toll < 1) {
    throw new InvalidTollError("toll must be an integer >= 1");
  }
}

export class Registry {
  private readonly crates = new Map<string, Crate>();
  private nextSeq = 0;

  constructor(private readonly maxCrates: number) {}

  has(id: string): boolean {
    return this.crates.has(id);
  }

  get(id: string): Crate | undefined {
    return this.crates.get(id);
  }

  size(): number {
    return this.crates.size;
  }

  stow(
    id: string,
    payload: unknown,
    ripeAt: number,
    rotAt: number,
    weight: number,
    toll: number,
  ): "accepted" | "updated" {
    const existing = this.crates.get(id);
    if (existing) {
      existing.payload = payload;
      existing.ripeAt = ripeAt;
      existing.rotAt = rotAt;
      existing.weight = weight;
      existing.toll = toll;
      return "updated";
    }
    if (this.crates.size >= this.maxCrates) {
      throw new CapacityError("moorbin is at capacity");
    }
    this.crates.set(id, {
      id,
      payload,
      ripeAt,
      rotAt,
      weight,
      toll,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.crates.delete(id);
  }

  /** All registered crates in first-stow order. */
  all(): Crate[] {
    return [...this.crates.values()];
  }
}

export function isRipe(crate: Crate, now: number): boolean {
  return crate.ripeAt <= now && now < crate.rotAt;
}

export function isRotten(crate: Crate, now: number): boolean {
  return now >= crate.rotAt;
}

export function snapshotOf(crate: Crate): CrateSnapshot {
  return {
    id: crate.id,
    payload: crate.payload,
    ripeAt: crate.ripeAt,
    rotAt: crate.rotAt,
    weight: crate.weight,
    toll: crate.toll,
  };
}

/** Stable retrieval order: heavier weight first, ties by first-stow seq. */
export function byRetrievalOrder(a: Crate, b: Crate): number {
  if (a.weight !== b.weight) return b.weight - a.weight;
  return a.seq - b.seq;
}
