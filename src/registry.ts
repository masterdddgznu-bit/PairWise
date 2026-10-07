import { InvalidBushelError, InvalidIdError, InvalidSpanError } from "./errors.js";

export interface Lot {
  id: string;
  payload: unknown;
  chargeAt: number;
  emptyAt: number;
  bushels: number;
  latched: boolean;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(chargeAt: unknown, emptyAt: unknown): void {
  if (
    !Number.isInteger(chargeAt) ||
    !Number.isInteger(emptyAt) ||
    (chargeAt as number) < 0 ||
    (emptyAt as number) < 0 ||
    (emptyAt as number) <= (chargeAt as number)
  ) {
    throw new InvalidSpanError(
      "chargeAt/emptyAt must be finite integers >= 0 with emptyAt > chargeAt",
    );
  }
}

export function assertValidBushels(bushels: unknown): void {
  if (!Number.isInteger(bushels) || (bushels as number) < 1) {
    throw new InvalidBushelError("bushels must be a finite integer >= 1");
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

  admit(id: string, payload: unknown, chargeAt: number, emptyAt: number, bushels: number): Lot {
    const lot: Lot = {
      id,
      payload,
      chargeAt,
      emptyAt,
      bushels,
      latched: true,
      seq: this.nextSeq++,
    };
    this.lots.set(id, lot);
    return lot;
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  inFirstAdmitOrder(): Lot[] {
    return [...this.lots.values()].sort((a, b) => a.seq - b.seq);
  }
}
