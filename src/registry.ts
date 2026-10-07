import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Mound {
  id: string;
  payload: unknown;
  bankAt: number;
  drawAt: number;
  cost: number;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(bankAt: unknown, drawAt: unknown): void {
  if (
    !Number.isInteger(bankAt) ||
    !Number.isInteger(drawAt) ||
    (bankAt as number) < 0 ||
    (drawAt as number) < 0 ||
    (drawAt as number) <= (bankAt as number)
  ) {
    throw new InvalidSpanError(
      "bankAt/drawAt must be integers >= 0 with drawAt > bankAt",
    );
  }
}

export function assertValidCost(cost: unknown): void {
  if (!Number.isInteger(cost) || (cost as number) < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class Registry {
  private readonly mounds = new Map<string, Mound>();
  private nextSeq = 0;

  constructor(private readonly capacity: number) {}

  has(id: string): boolean {
    return this.mounds.has(id);
  }

  get(id: string): Mound | undefined {
    return this.mounds.get(id);
  }

  size(): number {
    return this.mounds.size;
  }

  bank(
    id: string,
    payload: unknown,
    bankAt: number,
    drawAt: number,
    cost: number,
  ): "accepted" | "updated" {
    const existing = this.mounds.get(id);
    if (existing) {
      existing.payload = payload;
      existing.bankAt = bankAt;
      existing.drawAt = drawAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.mounds.size >= this.capacity) {
      throw new CapacityError("mound capacity reached");
    }
    this.mounds.set(id, {
      id,
      payload,
      bankAt,
      drawAt,
      cost,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.mounds.delete(id);
  }

  inFirstBankOrder(): Mound[] {
    return [...this.mounds.values()];
  }
}
