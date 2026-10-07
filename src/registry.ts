import { InvalidIdError, InvalidSpanError, InvalidYardsError } from "./errors.js";

export interface Quill {
  id: string;
  payload: unknown;
  spinAt: number;
  cutAt: number;
  yards: number;
  pinned: boolean;
  seq: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(spinAt: unknown, cutAt: unknown): void {
  if (
    !Number.isInteger(spinAt) ||
    !Number.isInteger(cutAt) ||
    (spinAt as number) < 0 ||
    (cutAt as number) < 0 ||
    (cutAt as number) <= (spinAt as number)
  ) {
    throw new InvalidSpanError(
      "span must be finite integers >= 0 with cutAt > spinAt",
    );
  }
}

export function validateYards(yards: unknown): void {
  if (!Number.isInteger(yards) || (yards as number) < 1) {
    throw new InvalidYardsError("yards must be a finite integer >= 1");
  }
}

export class QuillRegistry {
  private readonly quills = new Map<string, Quill>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.quills.has(id);
  }

  get(id: string): Quill | undefined {
    return this.quills.get(id);
  }

  size(): number {
    return this.quills.size;
  }

  admit(
    id: string,
    payload: unknown,
    spinAt: number,
    cutAt: number,
    yards: number,
  ): Quill {
    const quill: Quill = {
      id,
      payload,
      spinAt,
      cutAt,
      yards,
      pinned: true,
      seq: this.nextSeq++,
    };
    this.quills.set(id, quill);
    return quill;
  }

  remove(id: string): boolean {
    return this.quills.delete(id);
  }

  all(): Quill[] {
    return [...this.quills.values()].sort((a, b) => a.seq - b.seq);
  }
}
