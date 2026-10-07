import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { PigmentLedger } from "./ledger.js";
import { Lot, LotRegistry, LotSnapshot, snapshotOf } from "./registry.js";

export interface WoadVatOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialPigment?: number;
}

export interface DriveResult {
  drawn: LotSnapshot[];
  spent: string[];
}

function isRipe(lot: Lot, now: number): boolean {
  return lot.soakAt <= now && now < lot.rinseAt;
}

function isSpent(lot: Lot, now: number): boolean {
  return now >= lot.rinseAt;
}

function rank(a: Lot, b: Lot): number {
  if (a.soakAt !== b.soakAt) return a.soakAt - b.soakAt;
  if (a.pigment !== b.pigment) return b.pigment - a.pigment;
  return a.seq - b.seq;
}

export class WoadVat {
  private readonly clock: VirtualClock;
  private readonly registry: LotRegistry;
  private readonly ledger: PigmentLedger;

  constructor(options: WoadVatOptions) {
    const { clock, maxLots = 5, initialPigment = 0 } =
      options ?? ({} as WoadVatOptions);
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError("maxLots must be an integer >= 1");
    }
    if (!Number.isInteger(initialPigment) || initialPigment < 0) {
      throw new InvalidConfigError("initialPigment must be an integer >= 0");
    }
    this.clock = clock;
    this.registry = new LotRegistry(maxLots);
    this.ledger = new PigmentLedger(initialPigment);
  }

  store(
    id: string,
    payload: unknown,
    soakAt: number,
    rinseAt: number,
    pigment = 1,
  ): { status: "accepted" | "updated" } {
    LotRegistry.checkId(id);
    LotRegistry.checkSpan(soakAt, rinseAt);
    LotRegistry.checkPigment(pigment);
    return {
      status: this.registry.store(id, payload, soakAt, rinseAt, pigment),
    };
  }

  retune(id: string, soakAt: number, rinseAt: number): boolean {
    LotRegistry.checkId(id);
    LotRegistry.checkSpan(soakAt, rinseAt);
    return this.registry.retune(id, soakAt, rinseAt);
  }

  drop(id: string): boolean {
    LotRegistry.checkId(id);
    return this.registry.drop(id);
  }

  bind(id: string): boolean {
    LotRegistry.checkId(id);
    this.registry.require(id).bound = true;
    return true;
  }

  unbind(id: string): boolean {
    LotRegistry.checkId(id);
    this.registry.require(id).bound = false;
    return true;
  }

  isBound(id: string): boolean {
    LotRegistry.checkId(id);
    return this.registry.require(id).bound;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  pigment(): number {
    return this.ledger.available();
  }

  private candidates(now: number): Lot[] {
    return this.registry
      .inStoreOrder()
      .filter((lot) => !lot.bound && isRipe(lot, now))
      .sort(rank);
  }

  peek(): LotSnapshot | null {
    const [head] = this.candidates(this.clock.now());
    return head ? snapshotOf(head) : null;
  }

  pop(): LotSnapshot | null {
    const now = this.clock.now();
    for (const lot of this.candidates(now)) {
      if (this.ledger.canAfford(lot.pigment)) {
        this.ledger.spend(lot.pigment);
        this.registry.drop(lot.id);
        return snapshotOf(lot);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((lot) => lot.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const lot of this.registry.inStoreOrder()) {
      if (!lot.bound && isSpent(lot, now)) {
        this.registry.drop(lot.id);
        spent.push(lot.id);
      }
    }
    const drawn: LotSnapshot[] = [];
    for (;;) {
      const next = this.candidates(now).find((lot) =>
        this.ledger.canAfford(lot.pigment),
      );
      if (!next) break;
      this.ledger.spend(next.pigment);
      this.registry.drop(next.id);
      drawn.push(snapshotOf(next));
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.inStoreOrder().map((lot) => lot.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { soakAt: number; rinseAt: number } | null {
    LotRegistry.checkId(id);
    const lot = this.registry.get(id);
    return lot ? { soakAt: lot.soakAt, rinseAt: lot.rinseAt } : null;
  }

  pigmentOf(id: string): number | null {
    LotRegistry.checkId(id);
    const lot = this.registry.get(id);
    return lot ? lot.pigment : null;
  }
}
