import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSoakError,
  UnknownIdError,
} from "./errors.js";
import { SaltLedger } from "./ledger.js";
import {
  Lot,
  LotRegistry,
  LotSnapshot,
  isRipe,
  isSpoiled,
  snapshotOf,
} from "./registry.js";

export interface BrineVatOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialSalt?: number;
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidWindow(readyAt: number, spoilAt: number): void {
  if (
    !Number.isInteger(readyAt) ||
    !Number.isInteger(spoilAt) ||
    readyAt < 0 ||
    spoilAt < 0 ||
    spoilAt <= readyAt
  ) {
    throw new InvalidSoakError(
      "readyAt/spoilAt must be integers >= 0 with spoilAt > readyAt",
    );
  }
}

function assertValidCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class BrineVat {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly registry = new LotRegistry();
  private readonly ledger: SaltLedger;

  constructor(options: BrineVatOptions) {
    const maxLots = options.maxLots ?? 12;
    const initialSalt = options.initialSalt ?? 0;
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError("maxLots must be an integer >= 1");
    }
    if (!Number.isInteger(initialSalt) || initialSalt < 0) {
      throw new InvalidConfigError("initialSalt must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxLots = maxLots;
    this.ledger = new SaltLedger(initialSalt);
  }

  dip(
    id: string,
    payload: unknown,
    readyAt: number,
    spoilAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidWindow(readyAt, spoilAt);
    assertValidCost(cost);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.readyAt = readyAt;
      existing.spoilAt = spoilAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxLots) {
      throw new CapacityError("vat is at capacity");
    }
    this.registry.add(id, payload, readyAt, spoilAt, cost);
    return { status: "accepted" };
  }

  recure(id: string, readyAt: number, spoilAt: number): boolean {
    assertValidWindow(readyAt, spoilAt);
    const lot = this.registry.get(id);
    if (!lot) {
      return false;
    }
    lot.readyAt = readyAt;
    lot.spoilAt = spoilAt;
    return true;
  }

  dump(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  seal(id: string): boolean {
    this.requireLot(id).sealed = true;
    return true;
  }

  unseal(id: string): boolean {
    this.requireLot(id).sealed = false;
    return true;
  }

  isSealed(id: string): boolean {
    return this.requireLot(id).sealed;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  salt(): number {
    return this.ledger.value();
  }

  peek(): LotSnapshot | null {
    const [head] = this.candidates();
    return head ? snapshotOf(head) : null;
  }

  pop(): LotSnapshot | null {
    const target = this.candidates().find((lot) =>
      this.ledger.canAfford(lot.cost),
    );
    if (!target) {
      return null;
    }
    this.ledger.spend(target.cost);
    this.registry.remove(target.id);
    return snapshotOf(target);
  }

  ripeIds(): string[] {
    return this.candidates().map((lot) => lot.id);
  }

  drive(): { drawn: LotSnapshot[]; scrubbed: string[] } {
    const now = this.clock.now();
    const drawn: LotSnapshot[] = [];
    for (;;) {
      const target = this.candidates(now).find((lot) =>
        this.ledger.canAfford(lot.cost),
      );
      if (!target) {
        break;
      }
      this.ledger.spend(target.cost);
      this.registry.remove(target.id);
      drawn.push(snapshotOf(target));
    }
    const scrubbed = this.registry
      .all()
      .filter((lot) => !lot.sealed && isSpoiled(lot, now))
      .map((lot) => lot.id);
    for (const id of scrubbed) {
      this.registry.remove(id);
    }
    return { drawn, scrubbed };
  }

  ids(): string[] {
    return this.registry.all().map((lot) => lot.id);
  }

  size(): number {
    return this.registry.size;
  }

  soakOf(id: string): { readyAt: number; spoilAt: number } | null {
    assertValidId(id);
    const lot = this.registry.get(id);
    return lot ? { readyAt: lot.readyAt, spoilAt: lot.spoilAt } : null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    return this.registry.get(id)?.cost ?? null;
  }

  private candidates(now = this.clock.now()): Lot[] {
    return this.registry.ranked((lot) => !lot.sealed && isRipe(lot, now));
  }

  private requireLot(id: string): Lot {
    assertValidId(id);
    const lot = this.registry.get(id);
    if (!lot) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return lot;
  }
}
