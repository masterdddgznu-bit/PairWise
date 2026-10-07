import { InvalidIdError, InvalidSpanError, InvalidChillError } from "./errors.js";

export interface Parcel {
  id: string;
  payload: unknown;
  rimeAt: number;
  thawAt: number;
  chill: number;
  sealed: boolean;
  seq: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(rimeAt: unknown, thawAt: unknown): void {
  if (
    typeof rimeAt !== "number" ||
    !Number.isInteger(rimeAt) ||
    rimeAt < 0 ||
    typeof thawAt !== "number" ||
    !Number.isInteger(thawAt) ||
    thawAt < 0 ||
    thawAt <= rimeAt
  ) {
    throw new InvalidSpanError(
      "rimeAt/thawAt must be integers >= 0 with thawAt > rimeAt",
    );
  }
}

export function validateChill(chill: unknown): void {
  if (typeof chill !== "number" || !Number.isInteger(chill) || chill < 1) {
    throw new InvalidChillError("chill must be an integer >= 1");
  }
}

export class ParcelRegistry {
  private parcels = new Map<string, Parcel>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.parcels.has(id);
  }

  get(id: string): Parcel | undefined {
    return this.parcels.get(id);
  }

  size(): number {
    return this.parcels.size;
  }

  register(id: string, payload: unknown, rimeAt: number, thawAt: number, chill: number): Parcel {
    const parcel: Parcel = {
      id,
      payload,
      rimeAt,
      thawAt,
      chill,
      sealed: false,
      seq: this.nextSeq++,
    };
    this.parcels.set(id, parcel);
    return parcel;
  }

  remove(id: string): boolean {
    return this.parcels.delete(id);
  }

  inFirstStoreOrder(): Parcel[] {
    return [...this.parcels.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function compareDrawOrder(a: Parcel, b: Parcel): number {
  if (a.chill !== b.chill) return b.chill - a.chill;
  if (a.thawAt !== b.thawAt) return a.thawAt - b.thawAt;
  return a.seq - b.seq;
}
