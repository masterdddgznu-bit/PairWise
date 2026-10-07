import { VirtualClock } from "./clock.js";
import { CorkGate } from "./corks.js";
import { InvalidConfigError, UnknownIdError } from "./errors.js";
import { LyeLedger } from "./ledger.js";
import {
  assertCost,
  assertId,
  assertSpan,
  Bundle,
  BundleRegistry,
  BundleSnapshot,
  snapshotOf,
} from "./registry.js";

export interface FlaxSoakOptions {
  clock: VirtualClock;
  maxBundles?: number;
  initialLye?: number;
}

export interface DriveResult {
  lifted: BundleSnapshot[];
  spoiled: string[];
}

export class FlaxSoak {
  private readonly clock: VirtualClock;
  private readonly registry: BundleRegistry;
  private readonly corks = new CorkGate();
  private readonly ledger: LyeLedger;

  constructor(options: FlaxSoakOptions) {
    if (!options || !(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    const maxBundles = options.maxBundles ?? 6;
    if (!Number.isInteger(maxBundles) || maxBundles < 1) {
      throw new InvalidConfigError("maxBundles must be an integer >= 1");
    }
    const initialLye = options.initialLye ?? 0;
    if (!Number.isInteger(initialLye) || initialLye < 0) {
      throw new InvalidConfigError("initialLye must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new BundleRegistry(maxBundles);
    this.ledger = new LyeLedger(initialLye);
  }

  soak(
    id: string,
    payload: unknown,
    soakAt: number,
    liftAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(soakAt, liftAt);
    assertCost(cost);
    const status = this.registry.register(id, payload, soakAt, liftAt, cost);
    if (status === "accepted") {
      this.corks.cork(id);
    }
    return { status };
  }

  resoak(id: string, soakAt: number, liftAt: number): boolean {
    assertId(id);
    assertSpan(soakAt, liftAt);
    const bundle = this.registry.get(id);
    if (!bundle) {
      return false;
    }
    bundle.soakAt = soakAt;
    bundle.liftAt = liftAt;
    return true;
  }

  pull(id: string): boolean {
    assertId(id);
    const removed = this.registry.remove(id);
    if (!removed) {
      return false;
    }
    this.corks.forget(id);
    return true;
  }

  cork(id: string): boolean {
    this.requireKnown(id);
    this.corks.cork(id);
    return true;
  }

  uncork(id: string): boolean {
    this.requireKnown(id);
    this.corks.uncork(id);
    return true;
  }

  isCorked(id: string): boolean {
    this.requireKnown(id);
    return this.corks.isCorked(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  lye(): number {
    return this.ledger.lye();
  }

  peek(): BundleSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): BundleSnapshot | null {
    for (const bundle of this.candidates(this.clock.now())) {
      if (this.ledger.canAfford(bundle.cost)) {
        this.ledger.spend(bundle.cost);
        this.registry.remove(bundle.id);
        this.corks.forget(bundle.id);
        return snapshotOf(bundle);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((bundle) => bundle.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const lifted: BundleSnapshot[] = [];
    for (const bundle of this.candidates(now)) {
      if (this.ledger.canAfford(bundle.cost)) {
        this.ledger.spend(bundle.cost);
        this.registry.remove(bundle.id);
        this.corks.forget(bundle.id);
        lifted.push(snapshotOf(bundle));
      }
    }
    const spoiled: string[] = [];
    for (const bundle of this.registry.all()) {
      if (now > bundle.liftAt && !this.corks.isCorked(bundle.id)) {
        this.registry.remove(bundle.id);
        spoiled.push(bundle.id);
      }
    }
    return { lifted, spoiled };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { soakAt: number; liftAt: number } | null {
    assertId(id);
    const bundle = this.registry.get(id);
    if (!bundle) {
      return null;
    }
    return { soakAt: bundle.soakAt, liftAt: bundle.liftAt };
  }

  costOf(id: string): number | null {
    assertId(id);
    const bundle = this.registry.get(id);
    return bundle ? bundle.cost : null;
  }

  private requireKnown(id: string): void {
    assertId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private candidates(now: number): Bundle[] {
    return this.registry
      .all()
      .filter(
        (bundle) =>
          !this.corks.isCorked(bundle.id) &&
          bundle.soakAt < now &&
          now <= bundle.liftAt,
      )
      .sort(
        (a, b) => b.liftAt - a.liftAt || a.cost - b.cost || a.seq - b.seq,
      );
  }
}
