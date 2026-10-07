import {
  InvalidCharError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export interface Bloom {
  id: string;
  payload: unknown;
  glowAt: number;
  chillAt: number;
  char: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(glowAt: unknown, chillAt: unknown): void {
  if (
    typeof glowAt !== "number" ||
    !Number.isInteger(glowAt) ||
    glowAt < 0 ||
    typeof chillAt !== "number" ||
    !Number.isInteger(chillAt) ||
    chillAt < 0 ||
    chillAt <= glowAt
  ) {
    throw new InvalidSpanError(
      "glowAt/chillAt must be integers >= 0 with chillAt > glowAt",
    );
  }
}

export function validateChar(char: unknown): asserts char is number {
  if (typeof char !== "number" || !Number.isInteger(char) || char < 1) {
    throw new InvalidCharError("char must be an integer >= 1");
  }
}

export class BloomRegistry {
  private readonly blooms = new Map<string, Bloom>();

  has(id: string): boolean {
    return this.blooms.has(id);
  }

  get(id: string): Bloom | undefined {
    return this.blooms.get(id);
  }

  get size(): number {
    return this.blooms.size;
  }

  register(bloom: Bloom): void {
    this.blooms.set(bloom.id, bloom);
  }

  remove(id: string): boolean {
    return this.blooms.delete(id);
  }

  ids(): string[] {
    return [...this.blooms.keys()];
  }

  entries(): Bloom[] {
    return [...this.blooms.values()];
  }
}
