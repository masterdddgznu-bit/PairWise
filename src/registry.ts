import {
  CapacityError,
  InvalidIdError,
  InvalidSpanError,
  InvalidStrokesError,
  UnknownIdError,
} from "./errors.js";

export interface Oar {
  id: string;
  payload: unknown;
  readyAt: number;
  shipAt: number;
  strokes: number;
  pinned: boolean;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`invalid id: ${String(id)}`);
  }
}

export function assertValidSpan(readyAt: unknown, shipAt: unknown): void {
  if (
    !Number.isInteger(readyAt) ||
    !Number.isInteger(shipAt) ||
    (readyAt as number) < 0 ||
    (shipAt as number) < 0 ||
    (shipAt as number) <= (readyAt as number)
  ) {
    throw new InvalidSpanError(`invalid span: ${String(readyAt)}..${String(shipAt)}`);
  }
}

export function assertValidStrokes(strokes: unknown): void {
  if (!Number.isInteger(strokes) || (strokes as number) < 1) {
    throw new InvalidStrokesError(`invalid strokes: ${String(strokes)}`);
  }
}

export class Registry {
  private readonly oars = new Map<string, Oar>();
  private nextSeq = 0;

  constructor(private readonly maxOars: number) {}

  size(): number {
    return this.oars.size;
  }

  has(id: string): boolean {
    return this.oars.has(id);
  }

  get(id: string): Oar | undefined {
    return this.oars.get(id);
  }

  require(id: string): Oar {
    const oar = this.oars.get(id);
    if (!oar) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return oar;
  }

  ids(): string[] {
    return [...this.oars.values()].map((oar) => oar.id);
  }

  all(): Oar[] {
    return [...this.oars.values()];
  }

  seat(
    id: string,
    payload: unknown,
    readyAt: number,
    shipAt: number,
    strokes: number,
  ): "accepted" | "updated" {
    const existing = this.oars.get(id);
    if (existing) {
      existing.payload = payload;
      existing.readyAt = readyAt;
      existing.shipAt = shipAt;
      existing.strokes = strokes;
      existing.pinned = true;
      return "updated";
    }
    if (this.oars.size >= this.maxOars) {
      throw new CapacityError(`capacity reached: ${this.maxOars}`);
    }
    this.oars.set(id, {
      id,
      payload,
      readyAt,
      shipAt,
      strokes,
      pinned: true,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.oars.delete(id);
  }
}
