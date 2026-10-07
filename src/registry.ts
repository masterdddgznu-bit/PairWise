import { InvalidIdError, InvalidSpanError, InvalidWoodError } from "./errors.js";

export interface Charge {
  id: string;
  payload: unknown;
  kindleAt: number;
  bankAt: number;
  wood: number;
  seq: number;
}

export interface ChargeSnapshot {
  id: string;
  payload: unknown;
  kindleAt: number;
  bankAt: number;
  wood: number;
}

export function snapshotOf(charge: Charge): ChargeSnapshot {
  return {
    id: charge.id,
    payload: charge.payload,
    kindleAt: charge.kindleAt,
    bankAt: charge.bankAt,
    wood: charge.wood,
  };
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(kindleAt: unknown, bankAt: unknown): void {
  if (
    typeof kindleAt !== "number" ||
    !Number.isInteger(kindleAt) ||
    kindleAt < 0 ||
    typeof bankAt !== "number" ||
    !Number.isInteger(bankAt) ||
    bankAt < 0 ||
    bankAt <= kindleAt
  ) {
    throw new InvalidSpanError(
      "kindleAt/bankAt must be integers >= 0 with bankAt > kindleAt",
    );
  }
}

export function validateWood(wood: unknown): asserts wood is number {
  if (typeof wood !== "number" || !Number.isInteger(wood) || wood < 1) {
    throw new InvalidWoodError("wood must be an integer >= 1");
  }
}

export class ChargeRegistry {
  private readonly charges = new Map<string, Charge>();
  private nextSeq = 0;

  get size(): number {
    return this.charges.size;
  }

  has(id: string): boolean {
    return this.charges.has(id);
  }

  get(id: string): Charge | undefined {
    return this.charges.get(id);
  }

  add(
    id: string,
    payload: unknown,
    kindleAt: number,
    bankAt: number,
    wood: number,
  ): Charge {
    const charge: Charge = {
      id,
      payload,
      kindleAt,
      bankAt,
      wood,
      seq: this.nextSeq++,
    };
    this.charges.set(id, charge);
    return charge;
  }

  update(
    charge: Charge,
    payload: unknown,
    kindleAt: number,
    bankAt: number,
    wood: number,
  ): void {
    charge.payload = payload;
    charge.kindleAt = kindleAt;
    charge.bankAt = bankAt;
    charge.wood = wood;
  }

  remove(id: string): boolean {
    return this.charges.delete(id);
  }

  idsInLoadOrder(): string[] {
    return this.allInLoadOrder().map((charge) => charge.id);
  }

  allInLoadOrder(): Charge[] {
    return [...this.charges.values()].sort((a, b) => a.seq - b.seq);
  }
}
