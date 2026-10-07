import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Pan {
  id: string;
  payload: unknown;
  chargeAt: number;
  drawAt: number;
  cost: number;
  seq: number;
}

export interface PanSnapshot {
  id: string;
  payload: unknown;
  chargeAt: number;
  drawAt: number;
  cost: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(chargeAt: unknown, drawAt: unknown): void {
  if (
    typeof chargeAt !== "number" ||
    typeof drawAt !== "number" ||
    !Number.isInteger(chargeAt) ||
    !Number.isInteger(drawAt) ||
    chargeAt < 0 ||
    drawAt < 0 ||
    drawAt <= chargeAt
  ) {
    throw new InvalidSpanError(
      "chargeAt/drawAt must be integers >= 0 with drawAt > chargeAt",
    );
  }
}

function assertValidCost(cost: unknown): void {
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export function snapshotOf(pan: Pan): PanSnapshot {
  return {
    id: pan.id,
    payload: pan.payload,
    chargeAt: pan.chargeAt,
    drawAt: pan.drawAt,
    cost: pan.cost,
  };
}

export class PanRegistry {
  private readonly pans = new Map<string, Pan>();
  private nextSeq = 0;

  constructor(private readonly maxPans: number) {}

  size(): number {
    return this.pans.size;
  }

  has(id: string): boolean {
    return this.pans.has(id);
  }

  get(id: string): Pan | undefined {
    return this.pans.get(id);
  }

  ids(): string[] {
    return [...this.pans.keys()];
  }

  charge(
    id: string,
    payload: unknown,
    chargeAt: number,
    drawAt: number,
    cost: number,
  ): "accepted" | "updated" {
    assertValidId(id);
    assertValidSpan(chargeAt, drawAt);
    assertValidCost(cost);
    const existing = this.pans.get(id);
    if (existing) {
      existing.payload = payload;
      existing.chargeAt = chargeAt;
      existing.drawAt = drawAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.pans.size >= this.maxPans) {
      throw new CapacityError("pan capacity reached");
    }
    this.pans.set(id, {
      id,
      payload,
      chargeAt,
      drawAt,
      cost,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  recharge(id: string, chargeAt: number, drawAt: number): boolean {
    assertValidId(id);
    assertValidSpan(chargeAt, drawAt);
    const pan = this.pans.get(id);
    if (!pan) {
      return false;
    }
    pan.chargeAt = chargeAt;
    pan.drawAt = drawAt;
    return true;
  }

  remove(id: string): Pan | undefined {
    const pan = this.pans.get(id);
    if (pan) {
      this.pans.delete(id);
    }
    return pan;
  }

  inWindow(pan: Pan, now: number): boolean {
    return pan.chargeAt < now && now <= pan.drawAt;
  }

  overboiled(pan: Pan, now: number): boolean {
    return now > pan.drawAt;
  }

  ranked(pans: Iterable<Pan>): Pan[] {
    return [...pans].sort(
      (a, b) => b.drawAt - a.drawAt || b.cost - a.cost || a.seq - b.seq,
    );
  }

  values(): Iterable<Pan> {
    return this.pans.values();
  }
}
