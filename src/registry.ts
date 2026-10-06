import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Wick {
  id: string;
  payload: unknown;
  hangAt: number;
  pullAt: number;
  cost: number;
  pegged: boolean;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(hangAt: unknown, pullAt: unknown): void {
  if (
    typeof hangAt !== "number" ||
    !Number.isInteger(hangAt) ||
    hangAt < 0 ||
    typeof pullAt !== "number" ||
    !Number.isInteger(pullAt) ||
    pullAt <= hangAt
  ) {
    throw new InvalidSpanError(
      "span must be finite integers >= 0 with pullAt > hangAt",
    );
  }
}

export function assertValidCost(cost: unknown): void {
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be a finite integer >= 1");
  }
}

export class Registry {
  private readonly wicks = new Map<string, Wick>();
  private nextSeq = 0;

  constructor(private readonly maxWicks: number) {}

  get size(): number {
    return this.wicks.size;
  }

  get(id: string): Wick | undefined {
    return this.wicks.get(id);
  }

  hang(
    id: string,
    payload: unknown,
    hangAt: number,
    pullAt: number,
    cost: number,
  ): "accepted" | "updated" {
    const existing = this.wicks.get(id);
    if (existing) {
      existing.payload = payload;
      existing.hangAt = hangAt;
      existing.pullAt = pullAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.wicks.size >= this.maxWicks) {
      throw new CapacityError("wick capacity reached");
    }
    this.wicks.set(id, {
      id,
      payload,
      hangAt,
      pullAt,
      cost,
      pegged: true,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.wicks.delete(id);
  }

  inFirstHangOrder(): Wick[] {
    return [...this.wicks.values()];
  }

  ripeAt(now: number): Wick[] {
    return this.inFirstHangOrder()
      .filter((w) => !w.pegged && w.hangAt <= now && now < w.pullAt)
      .sort((a, b) => b.hangAt - a.hangAt || a.seq - b.seq);
  }

  overpulledAt(now: number): Wick[] {
    return this.inFirstHangOrder().filter((w) => !w.pegged && now >= w.pullAt);
  }
}
