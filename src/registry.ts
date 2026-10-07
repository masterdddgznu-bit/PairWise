import {
  InvalidFlakesError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface CableRecord {
  id: string;
  payload: unknown;
  stowAt: number;
  castAt: number;
  flakes: number;
  seq: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(stowAt: unknown, castAt: unknown): void {
  if (
    typeof stowAt !== "number" ||
    !Number.isInteger(stowAt) ||
    stowAt < 0 ||
    typeof castAt !== "number" ||
    !Number.isInteger(castAt) ||
    castAt < 0 ||
    (castAt as number) <= (stowAt as number)
  ) {
    throw new InvalidSpanError(
      "stowAt/castAt must be integers >= 0 with castAt > stowAt",
    );
  }
}

export function validateFlakes(flakes: unknown): asserts flakes is number {
  if (typeof flakes !== "number" || !Number.isInteger(flakes) || flakes < 1) {
    throw new InvalidFlakesError("flakes must be an integer >= 1");
  }
}

export class CableRegistry {
  private readonly records = new Map<string, CableRecord>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): CableRecord | undefined {
    return this.records.get(id);
  }

  get size(): number {
    return this.records.size;
  }

  seat(
    id: string,
    payload: unknown,
    stowAt: number,
    castAt: number,
    flakes: number,
  ): "accepted" | "updated" {
    const existing = this.records.get(id);
    if (existing) {
      existing.payload = payload;
      existing.stowAt = stowAt;
      existing.castAt = castAt;
      existing.flakes = flakes;
      return "updated";
    }
    this.records.set(id, {
      id,
      payload,
      stowAt,
      castAt,
      flakes,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  inFirstAdmitOrder(): CableRecord[] {
    return [...this.records.values()].sort((a, b) => a.seq - b.seq);
  }
}
