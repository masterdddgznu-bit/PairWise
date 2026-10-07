import { InvalidBlowError, InvalidIdError, InvalidSpanError } from "./errors.js";

export interface Die {
  id: string;
  payload: unknown;
  heatAt: number;
  chillAt: number;
  blow: number;
  seq: number;
}

export interface DieSnapshot {
  id: string;
  payload: unknown;
  heatAt: number;
  chillAt: number;
  blow: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(heatAt: unknown, chillAt: unknown): void {
  if (
    typeof heatAt !== "number" ||
    typeof chillAt !== "number" ||
    !Number.isInteger(heatAt) ||
    !Number.isInteger(chillAt) ||
    heatAt < 0 ||
    chillAt < 0 ||
    chillAt <= heatAt
  ) {
    throw new InvalidSpanError(
      "heatAt/chillAt must be integers >= 0 with chillAt > heatAt",
    );
  }
}

export function assertValidBlow(blow: unknown): void {
  if (typeof blow !== "number" || !Number.isInteger(blow) || blow < 1) {
    throw new InvalidBlowError("blow must be an integer >= 1");
  }
}

export function snapshotOf(die: Die): DieSnapshot {
  return {
    id: die.id,
    payload: die.payload,
    heatAt: die.heatAt,
    chillAt: die.chillAt,
    blow: die.blow,
  };
}

export class DieRegistry {
  private readonly dies = new Map<string, Die>();
  private nextSeq = 0;

  get size(): number {
    return this.dies.size;
  }

  has(id: string): boolean {
    return this.dies.has(id);
  }

  get(id: string): Die | undefined {
    return this.dies.get(id);
  }

  seat(id: string, payload: unknown, heatAt: number, chillAt: number, blow: number): Die {
    const die: Die = { id, payload, heatAt, chillAt, blow, seq: this.nextSeq++ };
    this.dies.set(id, die);
    return die;
  }

  remove(id: string): boolean {
    return this.dies.delete(id);
  }

  ids(): string[] {
    return [...this.dies.keys()];
  }

  entries(): Die[] {
    return [...this.dies.values()];
  }
}

export function isLive(die: Die, now: number): boolean {
  return now >= die.heatAt && now < die.chillAt;
}

export function isChilled(die: Die, now: number): boolean {
  return now >= die.chillAt;
}

export function compareRank(a: Die, b: Die): number {
  if (a.chillAt !== b.chillAt) return a.chillAt - b.chillAt;
  if (a.blow !== b.blow) return a.blow - b.blow;
  return a.seq - b.seq;
}
