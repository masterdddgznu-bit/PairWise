import { VirtualClock } from "./clock.js";
import { CapacityError, InvalidConfigError, UnknownIdError } from "./errors.js";
import { CreditLedger } from "./ledger.js";
import {
  Lot,
  LotRegistry,
  assertValidBushels,
  assertValidId,
  assertValidSpan,
} from "./registry.js";

export interface BurrStoneOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialCredit?: number;
}

export interface LotView {
  id: string;
  payload: unknown;
  chargeAt: number;
  emptyAt: number;
  bushels: number;
}

export interface GrindResult {
  milled: LotView[];
  spent: string[];
}

function viewOf(lot: Lot): LotView {
  return {
    id: lot.id,
    payload: lot.payload,
    chargeAt: lot.chargeAt,
    emptyAt: lot.emptyAt,
    bushels: lot.bushels,
  };
}

export class BurrStone {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly ledger: CreditLedger;
  private readonly registry = new LotRegistry();

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
    this.maxLots = maxLots;
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
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.chargeAt = chargeAt;
      existing.emptyAt = emptyAt;
      existing.bushels = bushels;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxLots) {
      throw new CapacityError("registry is at capacity");
    }
    this.registry.admit(id, payload, chargeAt, emptyAt, bushels);
    return { status: "accepted" };
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
    const lot = this.requireLot(id);
    lot.latched = true;
    return true;
  }

  unlatch(id: string): boolean {
    const lot = this.requireLot(id);
    lot.latched = false;
    return true;
  }

  isLatched(id: string): boolean {
    return this.requireLot(id).latched;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): LotView | null {
    const head = this.candidates()[0];
    return head ? viewOf(head) : null;
  }

  nibble(): LotView | null {
    const head = this.candidates()[0];
    if (!head) {
      return null;
    }
    if (!this.ledger.trySpend()) {
      return null;
    }
    head.bushels -= 1;
    const view = viewOf(head);
    if (head.bushels === 0) {
      this.registry.remove(head.id);
    }
    return view;
  }

  liveIds(): string[] {
    return this.candidates().map((lot) => lot.id);
  }

  grind(): GrindResult {
    const now = this.clock.now();
    const spentIds = this.registry
      .inFirstAdmitOrder()
      .filter((lot) => now > lot.emptyAt && !lot.latched)
      .map((lot) => lot.id);
    const milled: LotView[] = [];
    for (;;) {
      const head = this.candidates()[0];
      if (!head || !this.ledger.trySpend()) {
        break;
      }
      head.bushels -= 1;
      milled.push(viewOf(head));
      if (head.bushels === 0) {
        this.registry.remove(head.id);
      }
    }
    const spent: string[] = [];
    for (const id of spentIds) {
      if (this.registry.remove(id)) {
        spent.push(id);
      }
    }
    return { milled, spent };
  }

  ids(): string[] {
    return this.registry.inFirstAdmitOrder().map((lot) => lot.id);
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

  private requireLot(id: string): Lot {
    assertValidId(id);
    const lot = this.registry.get(id);
    if (!lot) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return lot;
  }

  private candidates(): Lot[] {
    const now = this.clock.now();
    return this.registry
      .inFirstAdmitOrder()
      .filter(
        (lot) =>
          !lot.latched &&
          lot.bushels >= 1 &&
          lot.chargeAt < now &&
          now <= lot.emptyAt,
      )
      .sort((a, b) => {
        if (a.emptyAt !== b.emptyAt) {
          return b.emptyAt - a.emptyAt;
        }
        if (a.bushels !== b.bushels) {
          return b.bushels - a.bushels;
        }
        return a.seq - b.seq;
      });
  }
}
