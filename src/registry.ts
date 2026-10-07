import {
  CapacityError,
  InvalidIdError,
  InvalidPigmentError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface Lot {
  id: string;
  payload: unknown;
  soakAt: number;
  rinseAt: number;
  pigment: number;
  bound: boolean;
  seq: number;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  soakAt: number;
  rinseAt: number;
  pigment: number;
}

export function snapshotOf(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    soakAt: lot.soakAt,
    rinseAt: lot.rinseAt,
    pigment: lot.pigment,
  };
}

export class LotRegistry {
  private lots = new Map<string, Lot>();
  private nextSeq = 0;

  constructor(private readonly maxLots: number) {}

  static checkId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  static checkSpan(soakAt: unknown, rinseAt: unknown): void {
    if (
      typeof soakAt !== "number" ||
      !Number.isInteger(soakAt) ||
      soakAt < 0 ||
      typeof rinseAt !== "number" ||
      !Number.isInteger(rinseAt) ||
      rinseAt <= soakAt
    ) {
      throw new InvalidSpanError(
        "soakAt/rinseAt must be integers >= 0 with rinseAt > soakAt",
      );
    }
  }

  static checkPigment(pigment: unknown): void {
    if (
      typeof pigment !== "number" ||
      !Number.isInteger(pigment) ||
      pigment < 1
    ) {
      throw new InvalidPigmentError("pigment must be an integer >= 1");
    }
  }

  store(
    id: string,
    payload: unknown,
    soakAt: number,
    rinseAt: number,
    pigment: number,
  ): "accepted" | "updated" {
    const existing = this.lots.get(id);
    if (existing) {
      existing.payload = payload;
      existing.soakAt = soakAt;
      existing.rinseAt = rinseAt;
      existing.pigment = pigment;
      return "updated";
    }
    if (this.lots.size >= this.maxLots) {
      throw new CapacityError("vat is at capacity");
    }
    this.lots.set(id, {
      id,
      payload,
      soakAt,
      rinseAt,
      pigment,
      bound: true,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  retune(id: string, soakAt: number, rinseAt: number): boolean {
    const lot = this.lots.get(id);
    if (!lot) return false;
    lot.soakAt = soakAt;
    lot.rinseAt = rinseAt;
    lot.bound = true;
    return true;
  }

  drop(id: string): boolean {
    return this.lots.delete(id);
  }

  get(id: string): Lot | undefined {
    return this.lots.get(id);
  }

  require(id: string): Lot {
    const lot = this.lots.get(id);
    if (!lot) {
      throw new UnknownIdError(`unknown lot id: ${id}`);
    }
    return lot;
  }

  get size(): number {
    return this.lots.size;
  }

  inStoreOrder(): Lot[] {
    return [...this.lots.values()].sort((a, b) => a.seq - b.seq);
  }
}
