import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { DrainGate } from "./gate.js";
import { QuotaLedger } from "./ledger.js";
import { Plot, PlotRegistry } from "./registry.js";

export interface PeatCutOptions {
  clock: VirtualClock;
  maxPlots?: number;
  initialQuota?: number;
}

export interface PlotView {
  id: string;
  payload: unknown;
  cutAt: number;
  stackAt: number;
  cost: number;
}

export interface DriveResult {
  lifted: PlotView[];
  spoiled: string[];
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(cutAt: unknown, stackAt: unknown): void {
  if (
    !isNonNegativeInt(cutAt) ||
    !isNonNegativeInt(stackAt) ||
    (stackAt as number) <= (cutAt as number)
  ) {
    throw new InvalidSpanError(
      "cutAt/stackAt must be integers >= 0 with stackAt > cutAt",
    );
  }
}

function viewOf(plot: Plot): PlotView {
  return {
    id: plot.id,
    payload: plot.payload,
    cutAt: plot.cutAt,
    stackAt: plot.stackAt,
    cost: plot.cost,
  };
}

export class PeatCut {
  private readonly clock: VirtualClock;
  private readonly maxPlots: number;
  private readonly registry = new PlotRegistry();
  private readonly gate = new DrainGate();
  private readonly ledger: QuotaLedger;

  constructor(options: PeatCutOptions) {
    if (!options || !(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    const maxPlots = options.maxPlots ?? 5;
    const initialQuota = options.initialQuota ?? 0;
    if (!isPositiveInt(maxPlots)) {
      throw new InvalidConfigError("maxPlots must be an integer >= 1");
    }
    if (!isNonNegativeInt(initialQuota)) {
      throw new InvalidConfigError("initialQuota must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxPlots = maxPlots;
    this.ledger = new QuotaLedger(initialQuota);
  }

  stake(
    id: string,
    payload: unknown,
    cutAt: number,
    stackAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(cutAt, stackAt);
    if (!isPositiveInt(cost)) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.cutAt = cutAt;
      existing.stackAt = stackAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxPlots) {
      throw new CapacityError("plot capacity reached");
    }
    this.registry.add(id, payload, cutAt, stackAt, cost);
    this.gate.close(id);
    return { status: "accepted" };
  }

  restake(id: string, cutAt: number, stackAt: number): boolean {
    assertId(id);
    assertSpan(cutAt, stackAt);
    const plot = this.registry.get(id);
    if (!plot) {
      return false;
    }
    plot.cutAt = cutAt;
    plot.stackAt = stackAt;
    return true;
  }

  yank(id: string): boolean {
    assertId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gate.forget(id);
    return true;
  }

  drain(id: string): boolean {
    this.requireKnown(id);
    this.gate.close(id);
    return true;
  }

  undrain(id: string): boolean {
    this.requireKnown(id);
    this.gate.open(id);
    return true;
  }

  isDrained(id: string): boolean {
    this.requireKnown(id);
    return this.gate.isClosed(id);
  }

  grant(amount: number): number {
    if (!isPositiveInt(amount)) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  quota(): number {
    return this.ledger.available();
  }

  peek(): PlotView | null {
    const head = this.candidates()[0];
    return head ? viewOf(head) : null;
  }

  pop(): PlotView | null {
    for (const plot of this.candidates()) {
      if (this.ledger.canAfford(plot.cost)) {
        this.lift(plot);
        return viewOf(plot);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates().map((plot) => plot.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spoiled: string[] = [];
    for (const plot of this.registry.entries()) {
      if (!this.gate.isClosed(plot.id) && now > plot.stackAt) {
        this.registry.remove(plot.id);
        this.gate.forget(plot.id);
        spoiled.push(plot.id);
      }
    }
    const lifted: PlotView[] = [];
    for (;;) {
      const next = this.candidates(now).find((plot) =>
        this.ledger.canAfford(plot.cost),
      );
      if (!next) {
        break;
      }
      this.lift(next);
      lifted.push(viewOf(next));
    }
    return { lifted, spoiled };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { cutAt: number; stackAt: number } | null {
    assertId(id);
    const plot = this.registry.get(id);
    return plot ? { cutAt: plot.cutAt, stackAt: plot.stackAt } : null;
  }

  costOf(id: string): number | null {
    assertId(id);
    const plot = this.registry.get(id);
    return plot ? plot.cost : null;
  }

  private requireKnown(id: string): void {
    assertId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private isRipe(plot: Plot, now: number): boolean {
    return plot.cutAt < now && now <= plot.stackAt;
  }

  private candidates(now: number = this.clock.now()): Plot[] {
    return this.registry
      .entries()
      .filter((plot) => !this.gate.isClosed(plot.id) && this.isRipe(plot, now))
      .sort(
        (a, b) => b.stackAt - a.stackAt || a.cost - b.cost || a.seq - b.seq,
      );
  }

  private lift(plot: Plot): void {
    this.ledger.spend(plot.cost);
    this.registry.remove(plot.id);
    this.gate.forget(plot.id);
  }
}
