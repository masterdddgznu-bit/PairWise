import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { CreditLedger } from "./ledger.js";
import {
  assertValidBushels,
  assertValidId,
  assertValidSpan,
  Lot,
  LotRegistry,
  LotSnapshot,
  snapshotOf,
} from "./registry.js";

export interface BurrStoneOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialCredit?: number;
}

export interface GrindResult {
  milled: LotSnapshot[];
  spent: string[];
}

function isLive(lot: Lot, now: number): boolean {
  return lot.chargeAt < now && now <= lot.emptyAt;
}

function isSpent(lot: Lot, now: number): boolean {
  return now > lot.emptyAt;
}

function compareCandidates(a: Lot, b: Lot): number {
  if (a.emptyAt !== b.emptyAt) {
    return b.emptyAt - a.emptyAt;
  }
  if (a.bushels !== b.bushels) {
    return b.bushels - a.bushels;
  }
  return a.seq - b.seq;
}

export class BurrStone {
  private readonly clock: VirtualClock;
  private readonly registry: LotRegistry;
  private readonly ledger: CreditLedger;

  constructor(options: BurrStoneOptions) {
    const maxLots = options.maxLots ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError("maxLots must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new LotRegistry(maxLots);
    this.ledger = new CreditLedger(initialCredit);
  }

  feed(
    id: string,
    payload: unknown,
    chargeAt: number,
    emptyAt: number,
    bushels = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(chargeAt, emptyAt);
    assertValidBushels(bushels);
    return {
      status: this.registry.admit(id, payload, chargeAt, emptyAt, bushels),
    };
  }

  dress(id: string, chargeAt: number, emptyAt: number): boolean {
    assertValidId(id);
    assertValidSpan(chargeAt, emptyAt);
    const lot = this.registry.get(id);
    if (!lot) {
      return false;
    }
    lot.chargeAt = chargeAt;
    lot.emptyAt = emptyAt;
    lot.latched = false;
    return true;
  }

  dump(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  latch(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).latched = true;
    return true;
  }

  unlatch(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).latched = false;
    return true;
  }

  isLatched(id: string): boolean {
    assertValidId(id);
    return this.registry.require(id).latched;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): LotSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  nibble(): LotSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.trySpend()) {
      return null;
    }
    head.bushels -= 1;
    const snapshot = snapshotOf(head);
    if (head.bushels === 0) {
      this.registry.remove(head.id);
    }
    return snapshot;
  }

  liveIds(): string[] {
    return this.candidates().map((lot) => lot.id);
  }

  grind(): GrindResult {
    const now = this.clock.now();
    const milled: LotSnapshot[] = [];
    for (;;) {
      const head = this.candidates()[0];
      if (!head || !this.ledger.trySpend()) {
        break;
      }
      head.bushels -= 1;
      milled.push(snapshotOf(head));
      if (head.bushels === 0) {
        this.registry.remove(head.id);
      }
    }
    const spent: string[] = [];
    for (const lot of this.registry.inAdmitOrder()) {
      if (!lot.latched && isSpent(lot, now)) {
        spent.push(lot.id);
        this.registry.remove(lot.id);
      }
    }
    return { milled, spent };
  }

  ids(): string[] {
    return this.registry.inAdmitOrder().map((lot) => lot.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { chargeAt: number; emptyAt: number } | null {
    assertValidId(id);
    const lot = this.registry.get(id);
    return lot ? { chargeAt: lot.chargeAt, emptyAt: lot.emptyAt } : null;
  }

  bushelsOf(id: string): number | null {
    assertValidId(id);
    const lot = this.registry.get(id);
    return lot ? lot.bushels : null;
  }

  private candidates(): Lot[] {
    const now = this.clock.now();
    return this.registry
      .inAdmitOrder()
      .filter((lot) => !lot.latched && lot.bushels >= 1 && isLive(lot, now))
      .sort(compareCandidates);
  }
}
