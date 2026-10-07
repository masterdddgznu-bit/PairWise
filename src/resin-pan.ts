import { InvalidConfigError } from "./errors.js";
import type { VirtualClock } from "./clock.js";
import { SpiritLedger } from "./spirit-ledger.js";
import {
  assertValidId,
  assertValidSpan,
  assertValidSpirit,
  compareLots,
  snapshotOf,
  LotRegistry,
  type Lot,
  type LotSnapshot,
} from "./lot-registry.js";

export interface ResinPanOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialSpirit?: number;
}

export interface DriveResult {
  drawn: LotSnapshot[];
  spent: string[];
}

function isRipe(lot: Lot, now: number): boolean {
  return lot.softenAt < now && now <= lot.hardenAt;
}

function isStale(lot: Lot, now: number): boolean {
  return now > lot.hardenAt;
}

export class ResinPan {
  private readonly clock: VirtualClock;
  private readonly registry: LotRegistry;
  private readonly ledger: SpiritLedger;

  constructor(options: ResinPanOptions) {
    const maxLots = options.maxLots ?? 5;
    const initialSpirit = options.initialSpirit ?? 0;
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError("maxLots must be an integer >= 1");
    }
    if (!Number.isInteger(initialSpirit) || initialSpirit < 0) {
      throw new InvalidConfigError("initialSpirit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new LotRegistry(maxLots);
    this.ledger = new SpiritLedger(initialSpirit);
  }

  charge(
    id: string,
    payload: unknown,
    softenAt: number,
    hardenAt: number,
    spirit = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(softenAt, hardenAt);
    assertValidSpirit(spirit);
    const status = this.registry.charge(id, payload, softenAt, hardenAt, spirit);
    return { status };
  }

  retune(id: string, softenAt: number, hardenAt: number): boolean {
    assertValidId(id);
    assertValidSpan(softenAt, hardenAt);
    const lot = this.registry.get(id);
    if (!lot) return false;
    lot.softenAt = softenAt;
    lot.hardenAt = hardenAt;
    lot.covered = false;
    return true;
  }

  drop(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  cover(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).covered = true;
    return true;
  }

  uncover(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).covered = false;
    return true;
  }

  isCovered(id: string): boolean {
    assertValidId(id);
    return this.registry.require(id).covered;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  spirit(): number {
    return this.ledger.available();
  }

  peek(): LotSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): LotSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.spirit)) {
      return null;
    }
    this.ledger.spend(head.spirit);
    this.registry.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((lot) => lot.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: LotSnapshot[] = [];
    for (const lot of this.candidates(now)) {
      if (!this.ledger.canAfford(lot.spirit)) break;
      this.ledger.spend(lot.spirit);
      this.registry.remove(lot.id);
      drawn.push(snapshotOf(lot));
    }
    const spent: string[] = [];
    for (const lot of this.registry.all()) {
      if (!lot.covered && isStale(lot, now)) {
        this.registry.remove(lot.id);
        spent.push(lot.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.all().map((lot) => lot.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { softenAt: number; hardenAt: number } | null {
    assertValidId(id);
    const lot = this.registry.get(id);
    if (!lot) return null;
    return { softenAt: lot.softenAt, hardenAt: lot.hardenAt };
  }

  spiritOf(id: string): number | null {
    assertValidId(id);
    return this.registry.get(id)?.spirit ?? null;
  }

  private candidates(now = this.clock.now()): Lot[] {
    return this.registry
      .all()
      .filter((lot) => !lot.covered && isRipe(lot, now))
      .sort(compareLots);
  }
}
