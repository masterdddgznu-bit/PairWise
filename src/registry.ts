import {
  InvalidFireError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Saggar {
  id: string;
  payload: unknown;
  soakAt: number;
  drawAt: number;
  fire: number;
  seq: number;
  latched: boolean;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(soakAt: unknown, drawAt: unknown): void {
  if (
    typeof soakAt !== "number" ||
    !Number.isInteger(soakAt) ||
    soakAt < 0 ||
    typeof drawAt !== "number" ||
    !Number.isInteger(drawAt) ||
    drawAt < 0 ||
    !(drawAt > soakAt)
  ) {
    throw new InvalidSpanError(
      "soakAt/drawAt must be integers >= 0 with drawAt > soakAt",
    );
  }
}

export function validateFire(fire: unknown): void {
  if (typeof fire !== "number" || !Number.isInteger(fire) || fire < 1) {
    throw new InvalidFireError("fire must be an integer >= 1");
  }
}

export class SaggarRegistry {
  private readonly byId = new Map<string, Saggar>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): Saggar | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  add(id: string, payload: unknown, soakAt: number, drawAt: number, fire: number): Saggar {
    const saggar: Saggar = {
      id,
      payload,
      soakAt,
      drawAt,
      fire,
      seq: this.nextSeq++,
      latched: false,
    };
    this.byId.set(id, saggar);
    return saggar;
  }

  remove(id: string): boolean {
    return this.byId.delete(id);
  }

  inFirstLoadOrder(): Saggar[] {
    return [...this.byId.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function isLive(saggar: Saggar, now: number): boolean {
  return saggar.soakAt < now && now <= saggar.drawAt;
}

export function isSpent(saggar: Saggar, now: number): boolean {
  return now > saggar.drawAt;
}

export function compareDrawRank(a: Saggar, b: Saggar): number {
  if (a.drawAt !== b.drawAt) return b.drawAt - a.drawAt;
  if (a.fire !== b.fire) return a.fire - b.fire;
  return a.seq - b.seq;
}
