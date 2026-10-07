import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import { BellowsGate } from "./gate.js";
import { CharLedger } from "./ledger.js";
import {
  Bloom,
  BloomRegistry,
  validateChar,
  validateId,
  validateSpan,
} from "./registry.js";

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

export interface DriveResult {
  drawn: BloomSnapshot[];
  spent: string[];
}

function snapshotOf(bloom: Bloom): BloomSnapshot {
  return {
    id: bloom.id,
    payload: bloom.payload,
    glowAt: bloom.glowAt,
    chillAt: bloom.chillAt,
    char: bloom.char,
  };
}

export class BloomHearth {
  private readonly clock: VirtualClock;
  private readonly maxBlooms: number;
  private readonly registry = new BloomRegistry();
  private readonly gate = new BellowsGate();
  private readonly ledger: CharLedger;

  constructor(options: BloomHearthOptions) {
    if (
      !options ||
      !options.clock ||
      typeof options.clock.now !== "function"
    ) {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    const maxBlooms = options.maxBlooms ?? 5;
    const initialChar = options.initialChar ?? 0;
    if (!Number.isInteger(maxBlooms) || maxBlooms < 1) {
      throw new InvalidConfigError("maxBlooms must be an integer >= 1");
    }
    if (!Number.isInteger(initialChar) || initialChar < 0) {
      throw new InvalidConfigError("initialChar must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxBlooms = maxBlooms;
    this.ledger = new CharLedger(initialChar);
  }

  load(
    id: string,
    payload: unknown,
    glowAt: number,
    chillAt: number,
    char = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(glowAt, chillAt);
    validateChar(char);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.glowAt = glowAt;
      existing.chillAt = chillAt;
      existing.char = char;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxBlooms) {
      throw new CapacityError("hearth is at capacity");
    }
    this.registry.register({ id, payload, glowAt, chillAt, char });
    return { status: "accepted" };
  }

  retune(id: string, glowAt: number, chillAt: number): boolean {
    validateId(id);
    validateSpan(glowAt, chillAt);
    const bloom = this.registry.get(id);
    if (!bloom) {
      return false;
    }
    bloom.glowAt = glowAt;
    bloom.chillAt = chillAt;
    this.gate.latch(id);
    return true;
  }

  drop(id: string): boolean {
    validateId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gate.clear(id);
    return true;
  }

  latch(id: string): boolean {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    this.gate.latch(id);
    return true;
  }

  unlatch(id: string): boolean {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    this.gate.unlatch(id);
    return true;
  }

  isLatched(id: string): boolean {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return this.gate.isLatched(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  char(): number {
    return this.ledger.available();
  }

  peek(): BloomSnapshot | null {
    const ranked = this.rankedCandidates(this.clock.now());
    return ranked.length === 0 ? null : snapshotOf(ranked[0]);
  }

  pop(): BloomSnapshot | null {
    const now = this.clock.now();
    for (const bloom of this.rankedCandidates(now)) {
      if (this.ledger.canAfford(bloom.char)) {
        this.ledger.spend(bloom.char);
        this.registry.remove(bloom.id);
        this.gate.clear(bloom.id);
        return snapshotOf(bloom);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.rankedCandidates(this.clock.now()).map((bloom) => bloom.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const bloom of this.registry.entries()) {
      if (bloom.chillAt <= now && !this.gate.isLatched(bloom.id)) {
        this.registry.remove(bloom.id);
        spent.push(bloom.id);
      }
    }
    const drawn: BloomSnapshot[] = [];
    for (const bloom of this.rankedCandidates(now)) {
      if (this.ledger.canAfford(bloom.char)) {
        this.ledger.spend(bloom.char);
        this.registry.remove(bloom.id);
        this.gate.clear(bloom.id);
        drawn.push(snapshotOf(bloom));
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { glowAt: number; chillAt: number } | null {
    validateId(id);
    const bloom = this.registry.get(id);
    if (!bloom) {
      return null;
    }
    return { glowAt: bloom.glowAt, chillAt: bloom.chillAt };
  }

  charOf(id: string): number | null {
    validateId(id);
    const bloom = this.registry.get(id);
    return bloom ? bloom.char : null;
  }

  private rankedCandidates(now: number): Bloom[] {
    return this.registry
      .entries()
      .filter(
        (bloom) =>
          bloom.glowAt <= now &&
          now < bloom.chillAt &&
          !this.gate.isLatched(bloom.id),
      )
      .sort((a, b) => b.char - a.char || a.chillAt - b.chillAt);
  }
}
