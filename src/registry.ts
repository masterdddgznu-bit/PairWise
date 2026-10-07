import { InvalidIdError, UnknownIdError } from "./errors.js";

export interface Saggar {
  id: string;
  payload: unknown;
  soakAt: number;
  drawAt: number;
  fire: number;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export class Registry {
  private readonly saggars = new Map<string, Saggar>();
  private readonly latchedIds = new Set<string>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.saggars.has(id);
  }

  get(id: string): Saggar | undefined {
    return this.saggars.get(id);
  }

  size(): number {
    return this.saggars.size;
  }

  ids(): string[] {
    return this.ordered().map((s) => s.id);
  }

  ordered(): Saggar[] {
    return [...this.saggars.values()].sort((a, b) => a.seq - b.seq);
  }

  add(id: string, payload: unknown, soakAt: number, drawAt: number, fire: number): Saggar {
    const saggar: Saggar = { id, payload, soakAt, drawAt, fire, seq: this.nextSeq++ };
    this.saggars.set(id, saggar);
    return saggar;
  }

  update(saggar: Saggar, payload: unknown, soakAt: number, drawAt: number, fire: number): void {
    saggar.payload = payload;
    saggar.soakAt = soakAt;
    saggar.drawAt = drawAt;
    saggar.fire = fire;
  }

  remove(id: string): boolean {
    this.latchedIds.delete(id);
    return this.saggars.delete(id);
  }

  latch(id: string): void {
    this.latchedIds.add(id);
  }

  unlatch(id: string): void {
    this.latchedIds.delete(id);
  }

  isLatched(id: string): boolean {
    return this.latchedIds.has(id);
  }

  requireKnown(id: string): Saggar {
    const saggar = this.saggars.get(id);
    if (!saggar) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return saggar;
  }
}
