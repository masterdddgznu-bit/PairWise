import { Limits, ReaderRecord } from "./types";
import { deepCopy } from "./util";

export class ReaderRegistry {
  private readers: ReaderRecord[] = [];

  constructor(private readonly limits: Limits) {}

  open(
    readerId: string,
    stripeId: string,
    generation: number,
    owner: string,
    ttl: number,
    now: number,
  ): ReaderRecord {
    if (this.readers.some((r) => r.readerId === readerId)) {
      throw new Error(`duplicate reader "${readerId}"`);
    }
    if (this.readers.length >= this.limits.readerSlots) {
      throw new Error(
        `reader capacity exceeded: ${this.limits.readerSlots} slots exhausted`,
      );
    }
    const reader: ReaderRecord = {
      readerId,
      stripeId,
      generation,
      owner,
      expiresAt: now + ttl,
    };
    this.readers.push(reader);
    return deepCopy(reader);
  }

  close(owner: string, readerId: string, now: number): void {
    const reader = this.readers.find((r) => r.readerId === readerId);
    if (!reader) {
      throw new Error(`unknown reader "${readerId}"`);
    }
    if (now >= reader.expiresAt) {
      throw new Error(`expired reader "${readerId}"`);
    }
    if (reader.owner !== owner) {
      throw new Error(`reader owner mismatch for "${readerId}"`);
    }
    this.readers = this.readers.filter((r) => r.readerId !== readerId);
  }

  expire(now: number): string[] {
    const expired = this.readers
      .filter((r) => now >= r.expiresAt)
      .map((r) => r.readerId);
    if (expired.length > 0) {
      this.readers = this.readers.filter((r) => now < r.expiresAt);
    }
    return expired;
  }

  pinnedGenerations(): Array<{ stripeId: string; generation: number }> {
    return this.readers.map((r) => ({
      stripeId: r.stripeId,
      generation: r.generation,
    }));
  }

  snapshot(): ReaderRecord[] {
    return deepCopy(this.readers);
  }
}
