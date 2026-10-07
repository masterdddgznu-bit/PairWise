import {
  InvalidIdError,
  InvalidImpressionsError,
  InvalidSpanError,
} from "./errors.js";

export interface Forme {
  id: string;
  payload: unknown;
  pressAt: number;
  liftAt: number;
  impressions: number;
}

export interface FormeSnapshot {
  id: string;
  payload: unknown;
  pressAt: number;
  liftAt: number;
  impressions: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(pressAt: unknown, liftAt: unknown): void {
  if (
    !Number.isInteger(pressAt) ||
    !Number.isInteger(liftAt) ||
    (pressAt as number) < 0 ||
    (liftAt as number) < 0 ||
    (liftAt as number) <= (pressAt as number)
  ) {
    throw new InvalidSpanError(
      "pressAt/liftAt must be integers >= 0 with liftAt > pressAt",
    );
  }
}

export function validateImpressions(impressions: unknown): void {
  if (!Number.isInteger(impressions) || (impressions as number) < 1) {
    throw new InvalidImpressionsError("impressions must be an integer >= 1");
  }
}

export function isLive(forme: Forme, now: number): boolean {
  return forme.pressAt < now && now <= forme.liftAt;
}

export function isSpent(forme: Forme, now: number): boolean {
  return now > forme.liftAt;
}

export function widthOf(forme: Forme): number {
  return forme.liftAt - forme.pressAt;
}

export function snapshotOf(forme: Forme): FormeSnapshot {
  return {
    id: forme.id,
    payload: forme.payload,
    pressAt: forme.pressAt,
    liftAt: forme.liftAt,
    impressions: forme.impressions,
  };
}

export class Registry {
  #formes = new Map<string, Forme>();

  get size(): number {
    return this.#formes.size;
  }

  has(id: string): boolean {
    return this.#formes.has(id);
  }

  get(id: string): Forme | undefined {
    return this.#formes.get(id);
  }

  add(forme: Forme): void {
    this.#formes.set(forme.id, forme);
  }

  remove(id: string): boolean {
    return this.#formes.delete(id);
  }

  ids(): string[] {
    return [...this.#formes.keys()];
  }

  entries(): Forme[] {
    return [...this.#formes.values()];
  }
}
