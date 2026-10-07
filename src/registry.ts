import {
  CapacityError,
  InvalidBushelError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface Lot {
  id: string;
  payload: unknown;
  chargeAt: number;
  emptyAt: number;
  bushels: number;
  latched: boolean;
  seq: number;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  chargeAt: number;
  emptyAt: number;
  bushels: number;
}

export function snapshotOf(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    chargeAt: lot.chargeAt,
    emptyAt: lot.emptyAt,
    bushels: lot.bushels,
  };
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(chargeAt: unknown, emptyAt: unknown): void {
  if (
    typeof chargeAt !== "number" ||
    !Number.isInteger(chargeAt) ||
    chargeAt < 0 ||
    typeof emptyAt !== "number" ||
    !Number.isInteger(emptyAt) ||
    emptyAt < 0 ||
    (typeof chargeAt === "number" &&
      typeof emptyAt === "number" &&
      emptyAt <= chargeAt)
  ) {
    throw new InvalidSpanError(
      "chargeAt/emptyAt must be integers >= 0 with emptyAt > chargeAt",
    );
  }
}

export function assertValidBushels(bushels: unknown): void {
  if (
    typeof bushels !== "number" ||
    !Number.isInteger(bushels) ||
    bushels < 1
  ) {
    throw new InvalidBushelError("bushels must be an integer >= 1");
  }
}

export class LotRegistry {
  private readonly lots = new Map<string, Lot>();
  private nextSeq = 0;

  constructor(private readonly maxLots: number) {}

  size(): number {
    return this.lots.size;
  }

  get(id: string): Lot | undefined {
    return this.lots.get(id);
  }

  require(id: string): Lot {
    const lot = this.lots.get(id);
    if (!lot) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return lot;
  }

  admit(
    id: string,
    payload: unknown,
    chargeAt: number,
    emptyAt: number,
    bushels: number,
  ): "accepted" | "updated" {
    const existing = this.lots.get(id);
    if (existing) {
      existing.payload = payload;
      existing.chargeAt = chargeAt;
      existing.emptyAt = emptyAt;
      existing.bushels = bushels;
      return "updated";
    }
    if (this.lots.size >= this.maxLots) {
      throw new CapacityError("lot registry is at capacity");
    }
    this.lots.set(id, {
      id,
      payload,
      chargeAt,
      emptyAt,
      bushels,
      latched: true,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  inAdmitOrder(): Lot[] {
    return [...this.lots.values()].sort((a, b) => a.seq - b.seq);
  }
}
