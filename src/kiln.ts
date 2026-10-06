import { VirtualClock } from "./clock.js";
import { DamperBank } from "./damper.js";
import {
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { FuelLedger } from "./fuel.js";
import { Pocket, PocketRegistry } from "./registry.js";

export interface OastKilnOptions {
  clock: VirtualClock;
  maxPockets?: number;
  initialFuel?: number;
}

export interface PocketView {
  id: string;
  payload: unknown;
  loadAt: number;
  unloadAt: number;
  cost: number;
}

export interface DriveResult {
  taken: PocketView[];
  flushed: string[];
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function viewOf(pocket: Pocket): PocketView {
  return {
    id: pocket.id,
    payload: pocket.payload,
    loadAt: pocket.loadAt,
    unloadAt: pocket.unloadAt,
    cost: pocket.cost,
  };
}

export class OastKiln {
  private readonly clock: VirtualClock;
  private readonly registry: PocketRegistry;
  private readonly dampers = new DamperBank();
  private readonly ledger: FuelLedger;

  constructor(options: OastKilnOptions) {
    const maxPockets = options.maxPockets ?? 5;
    const initialFuel = options.initialFuel ?? 0;
    if (!Number.isInteger(maxPockets) || maxPockets < 1) {
      throw new InvalidConfigError("maxPockets must be an integer >= 1");
    }
    if (!isNonNegativeInteger(initialFuel)) {
      throw new InvalidConfigError("initialFuel must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new PocketRegistry(maxPockets);
    this.ledger = new FuelLedger(initialFuel);
  }

  private requireValidId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private requireKnown(id: unknown): string {
    this.requireValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown pocket id: ${id}`);
    }
    return id;
  }

  private static requireValidSpan(loadAt: unknown, unloadAt: unknown): void {
    if (
      !isNonNegativeInteger(loadAt) ||
      !isNonNegativeInteger(unloadAt) ||
      unloadAt <= loadAt
    ) {
      throw new InvalidSpanError(
        "loadAt/unloadAt must be integers >= 0 with unloadAt > loadAt",
      );
    }
  }

  load(
    id: string,
    payload: unknown,
    loadAt: number,
    unloadAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    this.requireValidId(id);
    OastKiln.requireValidSpan(loadAt, unloadAt);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const status = this.registry.load(id, payload, loadAt, unloadAt, cost);
    if (status === "accepted") {
      this.dampers.register(id);
    }
    return { status };
  }

  reload(id: string, loadAt: number, unloadAt: number): boolean {
    this.requireValidId(id);
    OastKiln.requireValidSpan(loadAt, unloadAt);
    return this.registry.reload(id, loadAt, unloadAt);
  }

  dump(id: string): boolean {
    this.requireValidId(id);
    const removed = this.registry.dump(id);
    if (removed) {
      this.dampers.forget(id);
    }
    return removed;
  }

  seal(id: string): boolean {
    this.dampers.seal(this.requireKnown(id));
    return true;
  }

  vent(id: string): boolean {
    this.dampers.vent(this.requireKnown(id));
    return true;
  }

  isSealed(id: string): boolean {
    return this.dampers.isSealed(this.requireKnown(id));
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  fuel(): number {
    return this.ledger.available();
  }

  private isRipe(pocket: Pocket, now: number): boolean {
    return pocket.loadAt <= now && now < pocket.unloadAt;
  }

  private candidates(now: number): Pocket[] {
    return this.registry
      .entries()
      .filter(
        (pocket) => this.isRipe(pocket, now) && !this.dampers.isSealed(pocket.id),
      )
      .sort(
        (a, b) =>
          a.unloadAt - b.unloadAt || a.cost - b.cost || a.seq - b.seq,
      );
  }

  peek(): PocketView | null {
    const [first] = this.candidates(this.clock.now());
    return first ? viewOf(first) : null;
  }

  pop(): PocketView | null {
    const affordable = this.candidates(this.clock.now()).find(
      (pocket) => pocket.cost <= this.ledger.available(),
    );
    if (!affordable) {
      return null;
    }
    this.registry.dump(affordable.id);
    this.dampers.forget(affordable.id);
    this.ledger.spend(affordable.cost);
    return viewOf(affordable);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((pocket) => pocket.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const taken: PocketView[] = [];
    for (const pocket of this.candidates(now)) {
      if (pocket.cost <= this.ledger.available()) {
        this.registry.dump(pocket.id);
        this.dampers.forget(pocket.id);
        this.ledger.spend(pocket.cost);
        taken.push(viewOf(pocket));
      }
    }
    const flushed: string[] = [];
    for (const pocket of this.registry.entries()) {
      if (now >= pocket.unloadAt && !this.dampers.isSealed(pocket.id)) {
        this.registry.dump(pocket.id);
        this.dampers.forget(pocket.id);
        flushed.push(pocket.id);
      }
    }
    return { taken, flushed };
  }

  ids(): string[] {
    return this.registry.entries().map((pocket) => pocket.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { loadAt: number; unloadAt: number } | null {
    this.requireValidId(id);
    const pocket = this.registry.get(id);
    return pocket
      ? { loadAt: pocket.loadAt, unloadAt: pocket.unloadAt }
      : null;
  }

  costOf(id: string): number | null {
    this.requireValidId(id);
    return this.registry.get(id)?.cost ?? null;
  }
}
