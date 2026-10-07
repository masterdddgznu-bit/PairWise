import { VirtualClock } from "./clock.js";
import { CharLedger } from "./ledger.js";
import { BellowsGate } from "./gate.js";
import { BloomRegistry, type BloomRecord } from "./registry.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidCharError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export { VirtualClock } from "./clock.js";
export {
  BloomHearthError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidCharError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

export interface BloomHearthOptions {
  clock: VirtualClock;
  maxBlooms?: number;
  initialChar?: number;
}

export interface BloomSnapshot {
  id: string;
  payload: unknown;
  glowAt: number;
  chillAt: number;
  char: number;
}

function snapshotOf(record: BloomRecord): BloomSnapshot {
  return {
    id: record.id,
    payload: record.payload,
    glowAt: record.glowAt,
    chillAt: record.chillAt,
    char: record.char,
  };
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(glowAt: unknown, chillAt: unknown): void {
  if (
    typeof glowAt !== "number" ||
    !Number.isInteger(glowAt) ||
    glowAt < 0 ||
    typeof chillAt !== "number" ||
    !Number.isInteger(chillAt) ||
    chillAt < 0 ||
    chillAt <= glowAt
  ) {
    throw new InvalidSpanError("glowAt/chillAt must be integers >= 0 with chillAt > glowAt");
  }
}

function assertValidChar(char: unknown): void {
  if (typeof char !== "number" || !Number.isInteger(char) || char < 1) {
    throw new InvalidCharError("char must be an integer >= 1");
  }
}

export class BloomHearth {
  private readonly clock: VirtualClock;
  private readonly registry: BloomRegistry;
  private readonly gate = new BellowsGate();
  private readonly ledger: CharLedger;

  constructor(options: BloomHearthOptions) {
    const maxBlooms = options.maxBlooms ?? 5;
    const initialChar = options.initialChar ?? 0;
    if (!Number.isInteger(maxBlooms) || maxBlooms < 1) {
      throw new InvalidConfigError("maxBlooms must be an integer >= 1");
    }
    if (!Number.isInteger(initialChar) || initialChar < 0) {
      throw new InvalidConfigError("initialChar must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new BloomRegistry(maxBlooms);
    this.ledger = new CharLedger(initialChar);
  }

  load(
    id: string,
    payload: unknown,
    glowAt: number,
    chillAt: number,
    char = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(glowAt, chillAt);
    assertValidChar(char);
    const existing = this.registry.get(id);
    if (existing !== undefined) {
      this.registry.update(existing, payload, glowAt, chillAt, char);
      return { status: "updated" };
    }
    if (this.registry.isFull()) {
      throw new CapacityError("hearth is at capacity");
    }
    this.registry.add(id, payload, glowAt, chillAt, char);
    return { status: "accepted" };
  }

  retune(id: string, glowAt: number, chillAt: number): boolean {
    assertValidId(id);
    assertValidSpan(glowAt, chillAt);
    const record = this.registry.get(id);
    if (record === undefined) {
      return false;
    }
    this.registry.retune(record, glowAt, chillAt);
    this.gate.latch(id);
    return true;
  }

  drop(id: string): boolean {
    assertValidId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gate.forget(id);
    return true;
  }

  latch(id: string): boolean {
    this.requireRecord(id);
    this.gate.latch(id);
    return true;
  }

  unlatch(id: string): boolean {
    this.requireRecord(id);
    this.gate.unlatch(id);
    return true;
  }

  isLatched(id: string): boolean {
    this.requireRecord(id);
    return this.gate.isLatched(id);
  }

  grant(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  char(): number {
    return this.ledger.value();
  }

  peek(): BloomSnapshot | null {
    const ranked = this.rankedCandidates(this.clock.now());
    return ranked.length === 0 ? null : snapshotOf(ranked[0]);
  }

  pop(): BloomSnapshot | null {
    const ranked = this.rankedCandidates(this.clock.now());
    for (const record of ranked) {
      if (this.ledger.canAfford(record.char)) {
        this.ledger.spend(record.char);
        this.evict(record.id);
        return snapshotOf(record);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.rankedCandidates(this.clock.now()).map((record) => record.id);
  }

  drive(): { drawn: BloomSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const record of this.registry.values()) {
      if (record.chillAt <= now && !this.gate.isLatched(record.id)) {
        this.evict(record.id);
        spent.push(record.id);
      }
    }
    const drawn: BloomSnapshot[] = [];
    for (const record of this.rankedCandidates(now)) {
      if (this.ledger.canAfford(record.char)) {
        this.ledger.spend(record.char);
        this.evict(record.id);
        drawn.push(snapshotOf(record));
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { glowAt: number; chillAt: number } | null {
    assertValidId(id);
    const record = this.registry.get(id);
    return record === undefined
      ? null
      : { glowAt: record.glowAt, chillAt: record.chillAt };
  }

  charOf(id: string): number | null {
    assertValidId(id);
    const record = this.registry.get(id);
    return record === undefined ? null : record.char;
  }

  private requireRecord(id: string): BloomRecord {
    assertValidId(id);
    const record = this.registry.get(id);
    if (record === undefined) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return record;
  }

  private evict(id: string): void {
    this.registry.remove(id);
    this.gate.forget(id);
  }

  private rankedCandidates(now: number): BloomRecord[] {
    return this.registry
      .values()
      .filter(
        (record) =>
          !this.gate.isLatched(record.id) &&
          record.glowAt <= now &&
          now < record.chillAt,
      )
      .sort(
        (a, b) =>
          b.char - a.char || a.chillAt - b.chillAt || a.seq - b.seq,
      );
  }
}
