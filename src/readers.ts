import { Limits, ReaderView } from "./types";

interface ReaderRecord {
  id: string;
  owner: string;
  stripeId: string;
  generation: number;
  expiresAt: number;
}

export class ReaderRegistry {
  private readers: ReaderRecord[] = [];

  constructor(private readonly limits: Limits) {}

  open(
    id: string,
    owner: string,
    stripeId: string,
    generation: number,
    now: number,
    ttl: number,
    expectedGeneration?: number,
    expectedExpiresAt?: number,
  ): ReaderView {
    if (this.readers.some((reader) => reader.id === id)) {
      throw new Error(`duplicate reader: ${id}`);
    }
    if (this.readers.length >= this.limits.readerSlots) {
      throw new Error(`reader capacity: ${this.limits.readerSlots} slots exceeded`);
    }
    const expiresAt = now + ttl;
    if (expectedGeneration !== undefined && expectedGeneration !== generation) {
      throw new Error("journal transition: reader generation mismatch");
    }
    if (expectedExpiresAt !== undefined && expectedExpiresAt !== expiresAt) {
      throw new Error("journal transition: reader expiry mismatch");
    }
    const reader: ReaderRecord = { id, owner, stripeId, generation, expiresAt };
    this.readers.push(reader);
    return { ...reader };
  }

  close(owner: string, id: string, now: number): void {
    const index = this.readers.findIndex((reader) => reader.id === id);
    if (index < 0) {
      throw new Error(`unknown reader: ${id}`);
    }
    const reader = this.readers[index];
    if (now >= reader.expiresAt) {
      throw new Error(`expired reader: ${id} expired at ${reader.expiresAt}`);
    }
    if (reader.owner !== owner) {
      throw new Error(`reader owner mismatch: ${id} is owned by ${reader.owner}`);
    }
    this.readers.splice(index, 1);
  }

  expire(now: number): string[] {
    const expired: string[] = [];
    this.readers = this.readers.filter((reader) => {
      if (reader.expiresAt <= now) {
        expired.push(reader.id);
        return false;
      }
      return true;
    });
    return expired;
  }

  pins(stripeId: string, generation: number): boolean {
    return this.readers.some((reader) => reader.stripeId === stripeId && reader.generation === generation);
  }

  readerViews(): ReaderView[] {
    return this.readers.map((reader) => ({ ...reader }));
  }
}
