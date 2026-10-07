import { VirtualClock } from "./clock.js";
import { InvalidConfigError, UnknownIdError } from "./errors.js";
import { WaterLedger } from "./ledger.js";
import {
  assertValidCost,
  assertValidId,
  assertValidSpan,
  Bundle,
  Registry,
} from "./registry.js";

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

function viewOf(bundle: Bundle): BundleView {
  return {
    id: bundle.id,
    payload: bundle.payload,
    inAt: bundle.inAt,
    outAt: bundle.outAt,
    cost: bundle.cost,
  };
}

export class OsierPit {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly ledger: WaterLedger;

  constructor(options: OsierPitOptions) {
    const maxBundles = options?.maxBundles ?? 5;
    const initialWater = options?.initialWater ?? 0;
    if (!Number.isInteger(maxBundles) || maxBundles < 1) {
      throw new InvalidConfigError("maxBundles must be an integer >= 1");
    }
    if (!Number.isInteger(initialWater) || initialWater < 0) {
      throw new InvalidConfigError("initialWater must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new Registry(maxBundles);
    this.ledger = new WaterLedger(initialWater);
  }

  bind(
    id: string,
    payload: unknown,
    inAt: number,
    outAt: number,
    cost: number = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(inAt, outAt);
    assertValidCost(cost);
    return { status: this.registry.bind(id, payload, inAt, outAt, cost) };
  }

  rebind(id: string, inAt: number, outAt: number): boolean {
    assertValidId(id);
    assertValidSpan(inAt, outAt);
    const bundle = this.registry.get(id);
    if (!bundle) return false;
    bundle.inAt = inAt;
    bundle.outAt = outAt;
    return true;
  }

  yank(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  sluice(id: string): boolean {
    this.requireKnown(id).sluiced = true;
    return true;
  }

  unsluice(id: string): boolean {
    this.requireKnown(id).sluiced = false;
    return true;
  }

  isSluiced(id: string): boolean {
    return this.requireKnown(id).sluiced;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  water(): number {
    return this.ledger.water;
  }

  peek(): BundleView | null {
    const head = this.candidates()[0];
    return head ? viewOf(head) : null;
  }

  pop(): BundleView | null {
    const head = this.candidates()[0];
    if (!head) return null;
    if (!this.ledger.canAfford(head.cost)) return null;
    this.ledger.spend(head.cost);
    this.registry.remove(head.id);
    return viewOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((bundle) => bundle.id);
  }

  drive(): { drawn: BundleView[]; spoiled: string[] } {
    const now = this.clock.now();
    const drawn: BundleView[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (!head || !this.ledger.canAfford(head.cost)) break;
      this.ledger.spend(head.cost);
      this.registry.remove(head.id);
      drawn.push(viewOf(head));
    }
    const spoiled: string[] = [];
    for (const bundle of this.registry.allBySeq()) {
      if (!bundle.sluiced && now >= bundle.outAt) {
        this.registry.remove(bundle.id);
        spoiled.push(bundle.id);
      }
    }
    return { drawn, spoiled };
  }

  ids(): string[] {
    return this.registry.allBySeq().map((bundle) => bundle.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { inAt: number; outAt: number } | null {
    assertValidId(id);
    const bundle = this.registry.get(id);
    return bundle ? { inAt: bundle.inAt, outAt: bundle.outAt } : null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    const bundle = this.registry.get(id);
    return bundle ? bundle.cost : null;
  }

  private requireKnown(id: string): Bundle {
    assertValidId(id);
    const bundle = this.registry.get(id);
    if (!bundle) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return bundle;
  }

  private candidates(now: number = this.clock.now()): Bundle[] {
    return this.registry
      .allBySeq()
      .filter(
        (bundle) =>
          !bundle.sluiced && bundle.inAt <= now && now < bundle.outAt,
      )
      .sort((a, b) => a.outAt - b.outAt || b.cost - a.cost || a.seq - b.seq);
  }
}
