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
import { LotRegistry, type Lot } from "./registry.js";

export interface BrineVatOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialSalt?: number;
}

export interface LotView {
  id: string;
  payload: unknown;
  readyAt: number;
  spoilAt: number;
  cost: number;
}

export interface DriveResult {
  drawn: LotView[];
  scrubbed: string[];
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isValidWindow(readyAt: unknown, spoilAt: unknown): boolean {
  return (
    Number.isInteger(readyAt) &&
    Number.isInteger(spoilAt) &&
    (readyAt as number) >= 0 &&
    (spoilAt as number) >= 0 &&
    (spoilAt as number) > (readyAt as number)
  );
}

function viewOf(lot: Lot): LotView {
  return {
    id: lot.id,
    payload: lot.payload,
    readyAt: lot.readyAt,
    spoilAt: lot.spoilAt,
    cost: lot.cost,
  };
}

export class BrineVat {
  private readonly clock: VirtualClock;
  private readonly registry: LotRegistry;
  private readonly ledger: SaltLedger;

  constructor(options: BrineVatOptions) {
    const { clock, maxLots = 12, initialSalt = 0 } =
      options ?? ({} as BrineVatOptions);
    if (
      !clock ||
      typeof clock.now !== "function" ||
      !Number.isInteger(maxLots) ||
      maxLots < 1 ||
      !Number.isInteger(initialSalt) ||
      initialSalt < 0
    ) {
      throw new InvalidConfigError(
        "clock is required; maxLots must be an integer >= 1; initialSalt an integer >= 0",
      );
    }
    this.clock = clock;
    this.registry = new LotRegistry(maxLots);
    this.ledger = new SaltLedger(initialSalt);
  }

  private requireValidId(id: unknown): asserts id is string {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private requireKnown(id: unknown): Lot {
    this.requireValidId(id);
    const lot = this.registry.get(id);
    if (!lot) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return lot;
  }

  private static requireWindow(readyAt: unknown, spoilAt: unknown): void {
    if (!isValidWindow(readyAt, spoilAt)) {
      throw new InvalidSoakError(
        "readyAt/spoilAt must be integers >= 0 with spoilAt > readyAt",
      );
    }
  }

  dip(
    id: string,
    payload: unknown,
    readyAt: number,
    spoilAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    this.requireValidId(id);
    BrineVat.requireWindow(readyAt, spoilAt);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.readyAt = readyAt;
      existing.spoilAt = spoilAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.isFull) {
      throw new CapacityError("vat is at capacity");
    }
    this.registry.register(id, payload, readyAt, spoilAt, cost);
    return { status: "accepted" };
  }

  recure(id: string, readyAt: number, spoilAt: number): boolean {
    this.requireValidId(id);
    BrineVat.requireWindow(readyAt, spoilAt);
    const lot = this.registry.get(id);
    if (!lot) {
      return false;
    }
    lot.readyAt = readyAt;
    lot.spoilAt = spoilAt;
    return true;
  }

  dump(id: string): boolean {
    this.requireValidId(id);
    return this.registry.remove(id);
  }

  seal(id: string): boolean {
    this.requireKnown(id).sealed = true;
    return true;
  }

  unseal(id: string): boolean {
    this.requireKnown(id).sealed = false;
    return true;
  }

  isSealed(id: string): boolean {
    return this.requireKnown(id).sealed;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  salt(): number {
    return this.ledger.salt();
  }

  /** Ripe, unsealed candidates at `now`: later readyAt first, ties by first-dip seq. */
  private candidates(now: number): Lot[] {
    return this.registry
      .inOrder()
      .filter((lot) => !lot.sealed && lot.readyAt <= now && now < lot.spoilAt)
      .sort((a, b) => b.readyAt - a.readyAt || a.seq - b.seq);
  }

  peek(): LotView | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? viewOf(head) : null;
  }

  pop(): LotView | null {
    for (const lot of this.candidates(this.clock.now())) {
      if (this.ledger.canAfford(lot.cost)) {
        this.ledger.spend(lot.cost);
        this.registry.remove(lot.id);
        return viewOf(lot);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((lot) => lot.id);
  }

  drive(): DriveResult {
    const snapshot = this.clock.now();
    const drawn: LotView[] = [];
    for (;;) {
      const affordable = this.candidates(snapshot).find((lot) =>
        this.ledger.canAfford(lot.cost),
      );
      if (!affordable) {
        break;
      }
      this.ledger.spend(affordable.cost);
      this.registry.remove(affordable.id);
      drawn.push(viewOf(affordable));
    }
    const scrubbed: string[] = [];
    for (const lot of this.registry.inOrder()) {
      if (!lot.sealed && snapshot >= lot.spoilAt) {
        this.registry.remove(lot.id);
        scrubbed.push(lot.id);
      }
    }
    return { drawn, scrubbed };
  }

  ids(): string[] {
    return this.registry.inOrder().map((lot) => lot.id);
  }

  size(): number {
    return this.registry.size;
  }

  soakOf(id: string): { readyAt: number; spoilAt: number } | null {
    this.requireValidId(id);
    const lot = this.registry.get(id);
    return lot ? { readyAt: lot.readyAt, spoilAt: lot.spoilAt } : null;
  }

  costOf(id: string): number | null {
    this.requireValidId(id);
    return this.registry.get(id)?.cost ?? null;
  }
}
