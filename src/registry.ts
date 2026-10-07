import { InvalidIdError, InvalidSpanError, InvalidSpiritError } from "./errors.js";

export interface Lot {
  id: string;
  payload: unknown;
  softenAt: number;
  hardenAt: number;
  spirit: number;
  seq: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(softenAt: unknown, hardenAt: unknown): void {
  if (
    !Number.isInteger(softenAt) ||
    !Number.isInteger(hardenAt) ||
    (softenAt as number) < 0 ||
    (hardenAt as number) < 0 ||
    (hardenAt as number) <= (softenAt as number)
  ) {
    throw new InvalidSpanError(
      "softenAt/hardenAt must be integers >= 0 with hardenAt > softenAt",
    );
  }
}

export function validateSpirit(spirit: unknown): void {
  if (!Number.isInteger(spirit) || (spirit as number) < 1) {
    throw new InvalidSpiritError("spirit must be an integer >= 1");
  }
}

export class LotRegistry {
  private lots = new Map<string, Lot>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.lots.has(id);
  }

  get(id: string): Lot | undefined {
    return this.lots.get(id);
  }

  size(): number {
    return this.lots.size;
  }

  register(id: string, payload: unknown, softenAt: number, hardenAt: number, spirit: number): Lot {
    const lot: Lot = { id, payload, softenAt, hardenAt, spirit, seq: this.nextSeq++ };
    this.lots.set(id, lot);
    return lot;
  }

  update(lot: Lot, payload: unknown, softenAt: number, hardenAt: number, spirit: number): void {
    lot.payload = payload;
    lot.softenAt = softenAt;
    lot.hardenAt = hardenAt;
    lot.spirit = spirit;
  }

  retune(lot: Lot, softenAt: number, hardenAt: number): void {
    lot.softenAt = softenAt;
    lot.hardenAt = hardenAt;
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  allInFirstLoadOrder(): Lot[] {
    return [...this.lots.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function isRipe(lot: Lot, now: number): boolean {
  return lot.softenAt < now && now <= lot.hardenAt;
}

export function isStale(lot: Lot, now: number): boolean {
  return now > lot.hardenAt;
}

export function compareLots(a: Lot, b: Lot): number {
  if (a.hardenAt !== b.hardenAt) return a.hardenAt - b.hardenAt;
  if (a.spirit !== b.spirit) return a.spirit - b.spirit;
  return a.seq - b.seq;
}
