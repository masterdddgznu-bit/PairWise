import { InvalidIdError, UnknownIdError } from "./errors.js";

export interface Line {
  id: string;
  payload: unknown;
  makeAt: number;
  castAt: number;
  turns: number;
  belayed: boolean;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export class LineRegistry {
  private lines = new Map<string, Line>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.lines.has(id);
  }

  get(id: string): Line | undefined {
    return this.lines.get(id);
  }

  require(id: string): Line {
    const line = this.lines.get(id);
    if (!line) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return line;
  }

  add(id: string, payload: unknown, makeAt: number, castAt: number, turns: number): Line {
    const line: Line = {
      id,
      payload,
      makeAt,
      castAt,
      turns,
      belayed: false,
      seq: this.nextSeq++,
    };
    this.lines.set(id, line);
    return line;
  }

  remove(id: string): boolean {
    return this.lines.delete(id);
  }

  size(): number {
    return this.lines.size;
  }

  inFirstAdmitOrder(): Line[] {
    return [...this.lines.values()].sort((a, b) => a.seq - b.seq);
  }
}
