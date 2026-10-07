import { VirtualClock } from "./clock.js";
import { FireLedger } from "./ledger.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import {
  SaggarRegistry,
  compareDrawRank,
  isLive,
  isSpent,
  validateFire,
  validateId,
  validateSpan,
  type Saggar,
} from "./registry.js";

export { VirtualClock } from "./clock.js";
export {
  SaggarBedError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidFireError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

export interface SaggarBedOptions {
  clock: VirtualClock;
  maxSaggars?: number;
  initialCredit?: number;
}

export interface SaggarSnapshot {
  id: string;
  payload: unknown;
  soakAt: number;
  drawAt: number;
  fire: number;
}

function snapshotOf(saggar: Saggar): SaggarSnapshot {
  return {
    id: saggar.id,
    payload: saggar.payload,
    soakAt: saggar.soakAt,
    drawAt: saggar.drawAt,
    fire: saggar.fire,
  };
}

export class SaggarBed {
  private readonly clock: VirtualClock;
  private readonly maxSaggars: number;
  private readonly ledger: FireLedger;
  private readonly registry = new SaggarRegistry();

  constructor(options: SaggarBedOptions) {
    const maxSaggars = options.maxSaggars ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxSaggars) || maxSaggars < 1) {
      throw new InvalidConfigError("maxSaggars must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxSaggars = maxSaggars;
    this.ledger = new FireLedger(initialCredit);
  }

  load(
    id: string,
    payload: unknown,
    soakAt: number,
    drawAt: number,
    fire = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(soakAt, drawAt);
    validateFire(fire);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.soakAt = soakAt;
      existing.drawAt = drawAt;
      existing.fire = fire;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxSaggars) {
      throw new CapacityError("saggar bed is at capacity");
    }
    this.registry.add(id, payload, soakAt, drawAt, fire);
    return { status: "accepted" };
  }

  retune(id: string, soakAt: number, drawAt: number): boolean {
    validateId(id);
    validateSpan(soakAt, drawAt);
    const saggar = this.registry.get(id);
    if (!saggar) return false;
    saggar.soakAt = soakAt;
    saggar.drawAt = drawAt;
    saggar.latched = true;
    return true;
  }

  dump(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  latch(id: string): boolean {
    validateId(id);
    const saggar = this.registry.get(id);
    if (!saggar) throw new UnknownIdError(`unknown id: ${id}`);
    saggar.latched = true;
    return true;
  }

  unlatch(id: string): boolean {
    validateId(id);
    const saggar = this.registry.get(id);
    if (!saggar) throw new UnknownIdError(`unknown id: ${id}`);
    saggar.latched = false;
    return true;
  }

  isLatched(id: string): boolean {
    validateId(id);
    const saggar = this.registry.get(id);
    if (!saggar) throw new UnknownIdError(`unknown id: ${id}`);
    return saggar.latched;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  private drawCandidates(now: number): Saggar[] {
    return this.registry
      .inFirstLoadOrder()
      .filter((s) => !s.latched && isLive(s, now))
      .sort(compareDrawRank);
  }

  peek(): SaggarSnapshot | null {
    const candidates = this.drawCandidates(this.clock.now());
    return candidates.length > 0 ? snapshotOf(candidates[0]) : null;
  }

  draw(): SaggarSnapshot | null {
    const candidates = this.drawCandidates(this.clock.now());
    for (const candidate of candidates) {
      if (this.ledger.canAfford(candidate.fire)) {
        this.ledger.spend(candidate.fire);
        this.registry.remove(candidate.id);
        return snapshotOf(candidate);
      }
    }
    return null;
  }

  liveIds(): string[] {
    return this.drawCandidates(this.clock.now()).map((s) => s.id);
  }

  fire(): { drawn: SaggarSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const drawn: SaggarSnapshot[] = [];
    for (;;) {
      const candidates = this.drawCandidates(now);
      const affordable = candidates.find((c) => this.ledger.canAfford(c.fire));
      if (!affordable) break;
      this.ledger.spend(affordable.fire);
      this.registry.remove(affordable.id);
      drawn.push(snapshotOf(affordable));
    }
    const spent: string[] = [];
    for (const saggar of this.registry.inFirstLoadOrder()) {
      if (!saggar.latched && isSpent(saggar, now)) {
        this.registry.remove(saggar.id);
        spent.push(saggar.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.inFirstLoadOrder().map((s) => s.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { soakAt: number; drawAt: number } | null {
    validateId(id);
    const saggar = this.registry.get(id);
    if (!saggar) return null;
    return { soakAt: saggar.soakAt, drawAt: saggar.drawAt };
  }

  fireOf(id: string): number | null {
    validateId(id);
    const saggar = this.registry.get(id);
    return saggar ? saggar.fire : null;
  }
}
