import {
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { VirtualClock } from "./clock.js";
import { PlotRegistry, byRank, snapshotOf } from "./registry.js";
import type { Plot, PlotSnapshot } from "./registry.js";
import { DrainGates } from "./gates.js";
import { QuotaLedger } from "./ledger.js";

export interface PeatCutOptions {
  clock: VirtualClock;
  maxPlots?: number;
  initialQuota?: number;
}

export interface StakeResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  lifted: PlotSnapshot[];
  spoiled: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function isValidSpanBound(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function assertValidSpan(cutAt: unknown, stackAt: unknown): void {
  if (
    !isValidSpanBound(cutAt) ||
    !isValidSpanBound(stackAt) ||
    stackAt <= cutAt
  ) {
    throw new InvalidSpanError(
      "cutAt/stackAt must be integers >= 0 with stackAt > cutAt",
    );
  }
}

export class PeatCut {
  #clock: VirtualClock;
  #registry: PlotRegistry;
  #gates = new DrainGates();
  #ledger: QuotaLedger;

  constructor(options: PeatCutOptions) {
    const maxPlots = options?.maxPlots ?? 5;
    const initialQuota = options?.initialQuota ?? 0;
    if (!Number.isInteger(maxPlots) || maxPlots < 1) {
      throw new InvalidConfigError("maxPlots must be an integer >= 1");
    }
    if (!Number.isInteger(initialQuota) || initialQuota < 0) {
      throw new InvalidConfigError("initialQuota must be an integer >= 0");
    }
    if (!options || !(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    this.#clock = options.clock;
    this.#registry = new PlotRegistry(maxPlots);
    this.#ledger = new QuotaLedger(initialQuota);
  }

  stake(
    id: string,
    payload: unknown,
    cutAt: number,
    stackAt: number,
    cost = 1,
  ): StakeResult {
    assertValidId(id);
    assertValidSpan(cutAt, stackAt);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const existing = this.#registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.cutAt = cutAt;
      existing.stackAt = stackAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    const plot = this.#registry.add(id, payload, cutAt, stackAt, cost);
    this.#gates.close(plot.id);
    return { status: "accepted" };
  }

  restake(id: string, cutAt: number, stackAt: number): boolean {
    assertValidSpan(cutAt, stackAt);
    const plot = this.#registry.get(id);
    if (!plot) return false;
    plot.cutAt = cutAt;
    plot.stackAt = stackAt;
    return true;
  }

  yank(id: string): boolean {
    assertValidId(id);
    if (!this.#registry.remove(id)) return false;
    this.#gates.forget(id);
    return true;
  }

  drain(id: string): boolean {
    assertValidId(id);
    this.#requireKnown(id);
    this.#gates.close(id);
    return true;
  }

  undrain(id: string): boolean {
    assertValidId(id);
    this.#requireKnown(id);
    this.#gates.open(id);
    return true;
  }

  isDrained(id: string): boolean {
    assertValidId(id);
    this.#requireKnown(id);
    return this.#gates.isClosed(id);
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.#ledger.grant(amount);
  }

  quota(): number {
    return this.#ledger.balance;
  }

  peek(): PlotSnapshot | null {
    const head = this.#candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): PlotSnapshot | null {
    const target = this.#candidates().find((plot) =>
      this.#ledger.canAfford(plot.cost),
    );
    if (!target) return null;
    this.#ledger.spend(target.cost);
    this.#registry.remove(target.id);
    this.#gates.forget(target.id);
    return snapshotOf(target);
  }

  ripeIds(): string[] {
    return this.#candidates().map((plot) => plot.id);
  }

  drive(): DriveResult {
    const now = this.#clock.now();
    const spoiled: string[] = [];
    for (const plot of this.#registry.inFirstStakeOrder()) {
      if (!this.#gates.isClosed(plot.id) && now > plot.stackAt) {
        spoiled.push(plot.id);
      }
    }
    for (const id of spoiled) {
      this.#registry.remove(id);
      this.#gates.forget(id);
    }
    const lifted: PlotSnapshot[] = [];
    for (;;) {
      const target = this.#candidates(now).find((plot) =>
        this.#ledger.canAfford(plot.cost),
      );
      if (!target) break;
      this.#ledger.spend(target.cost);
      this.#registry.remove(target.id);
      this.#gates.forget(target.id);
      lifted.push(snapshotOf(target));
    }
    return { lifted, spoiled };
  }

  ids(): string[] {
    return this.#registry.inFirstStakeOrder().map((plot) => plot.id);
  }

  size(): number {
    return this.#registry.size;
  }

  spanOf(id: string): { cutAt: number; stackAt: number } | null {
    assertValidId(id);
    const plot = this.#registry.get(id);
    if (!plot) return null;
    return { cutAt: plot.cutAt, stackAt: plot.stackAt };
  }

  costOf(id: string): number | null {
    assertValidId(id);
    const plot = this.#registry.get(id);
    return plot ? plot.cost : null;
  }

  #requireKnown(id: string): void {
    if (!this.#registry.has(id)) {
      throw new UnknownIdError(`unknown plot id: ${id}`);
    }
  }

  #candidates(now = this.#clock.now()): Plot[] {
    return this.#registry
      .inFirstStakeOrder()
      .filter(
        (plot) =>
          !this.#gates.isClosed(plot.id) &&
          plot.cutAt < now &&
          now <= plot.stackAt,
      )
      .sort(byRank);
  }
}
