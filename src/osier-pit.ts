import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { WaterLedger } from "./ledger.js";
import { Bundle, Registry } from "./registry.js";

export interface OsierPitOptions {
  clock: VirtualClock;
  maxBundles?: number;
  initialWater?: number;
}

export interface BundleView {
  id: string;
  payload: unknown;
  inAt: number;
  outAt: number;
  cost: number;
}

export interface DriveResult {
  drawn: BundleView[];
  spoiled: string[];
}

function viewOf(bundle: Bundle): BundleView {
  return {
    id: bundle.id,
    payload: bundle.payload,
    inAt: bundle.inAt,
    outAt: bundle.outAt,
    cost: bundle.cost,
  };
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(inAt: unknown, outAt: unknown): void {
  if (
    !Number.isInteger(inAt) ||
    !Number.isInteger(outAt) ||
    (inAt as number) < 0 ||
    (outAt as number) < 0 ||
    (outAt as number) <= (inAt as number)
  ) {
    throw new InvalidSpanError(
      "inAt/outAt must be integers >= 0 with outAt > inAt",
    );
  }
}

export class OsierPit {
  private readonly clock: VirtualClock;
  private readonly maxBundles: number;
  private readonly ledger: WaterLedger;
  private readonly registry = new Registry();

  constructor(options: OsierPitOptions) {
    const maxBundles = options.maxBundles ?? 5;
    const initialWater = options.initialWater ?? 0;
    if (!Number.isInteger(maxBundles) || maxBundles < 1) {
      throw new InvalidConfigError("maxBundles must be an integer >= 1");
    }
    if (!Number.isInteger(initialWater) || initialWater < 0) {
      throw new InvalidConfigError("initialWater must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxBundles = maxBundles;
    this.ledger = new WaterLedger(initialWater);
  }

  bind(
    id: string,
    payload: unknown,
    inAt: number,
    outAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(inAt, outAt);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.inAt = inAt;
      existing.outAt = outAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxBundles) {
      throw new CapacityError("pit is at capacity");
    }
    this.registry.add(id, payload, inAt, outAt, cost);
    return { status: "accepted" };
  }

  rebind(id: string, inAt: number, outAt: number): boolean {
    assertId(id);
    assertSpan(inAt, outAt);
    const bundle = this.registry.get(id);
    if (!bundle) return false;
    bundle.inAt = inAt;
    bundle.outAt = outAt;
    return true;
  }

  yank(id: string): boolean {
    assertId(id);
    return this.registry.remove(id);
  }

  sluice(id: string): boolean {
    this.requireBundle(id).sluiced = true;
    return true;
  }

  unsluice(id: string): boolean {
    this.requireBundle(id).sluiced = false;
    return true;
  }

  isSluiced(id: string): boolean {
    return this.requireBundle(id).sluiced;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  water(): number {
    return this.ledger.water();
  }

  peek(): BundleView | null {
    const head = this.registry.ranked(this.clock.now())[0];
    return head ? viewOf(head) : null;
  }

  pop(): BundleView | null {
    const head = this.registry.ranked(this.clock.now())[0];
    if (!head || !this.ledger.canAfford(head.cost)) return null;
    this.ledger.spend(head.cost);
    this.registry.remove(head.id);
    return viewOf(head);
  }

  ripeIds(): string[] {
    return this.registry.ranked(this.clock.now()).map((b) => b.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: BundleView[] = [];
    for (;;) {
      const head = this.registry.ranked(now)[0];
      if (!head || !this.ledger.canAfford(head.cost)) break;
      this.ledger.spend(head.cost);
      this.registry.remove(head.id);
      drawn.push(viewOf(head));
    }
    const spoiled: string[] = [];
    for (const bundle of this.registry.all()) {
      if (!bundle.sluiced && bundle.outAt <= now) {
        this.registry.remove(bundle.id);
        spoiled.push(bundle.id);
      }
    }
    return { drawn, spoiled };
  }

  ids(): string[] {
    return this.registry.all().map((b) => b.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { inAt: number; outAt: number } | null {
    assertId(id);
    const bundle = this.registry.get(id);
    return bundle ? { inAt: bundle.inAt, outAt: bundle.outAt } : null;
  }

  costOf(id: string): number | null {
    assertId(id);
    const bundle = this.registry.get(id);
    return bundle ? bundle.cost : null;
  }

  private requireBundle(id: string): Bundle {
    assertId(id);
    const bundle = this.registry.get(id);
    if (!bundle) throw new UnknownIdError(`unknown id: ${id}`);
    return bundle;
  }
}
