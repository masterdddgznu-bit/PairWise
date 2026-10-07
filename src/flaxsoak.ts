import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { LyeLedger } from "./ledger.js";
import { BundleRecord, BundleRegistry, snapshotOf } from "./registry.js";

export interface FlaxSoakOptions {
  clock: VirtualClock;
  maxBundles?: number;
  initialLye?: number;
}

export type SoakStatus = { status: "accepted" | "updated" };

export interface DriveResult {
  lifted: BundleRecord[];
  spoiled: string[];
}

const DEFAULT_MAX_BUNDLES = 6;
const DEFAULT_INITIAL_LYE = 0;

export class FlaxSoak {
  private readonly clock: VirtualClock;
  private readonly registry: BundleRegistry;
  private readonly ledger: LyeLedger;
  private readonly maxBundles: number;

  constructor(options: FlaxSoakOptions) {
    if (!options || typeof options !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    const { clock } = options;
    if (
      !clock ||
      typeof clock.now !== "function" ||
      typeof clock.advance !== "function"
    ) {
      throw new InvalidConfigError("a VirtualClock with now()/advance() is required");
    }
    const maxBundles = options.maxBundles ?? DEFAULT_MAX_BUNDLES;
    if (!Number.isInteger(maxBundles) || maxBundles < 1) {
      throw new InvalidConfigError(`maxBundles must be an integer >= 1, got ${maxBundles}`);
    }
    const initialLye = options.initialLye ?? DEFAULT_INITIAL_LYE;
    if (!Number.isInteger(initialLye) || initialLye < 0) {
      throw new InvalidConfigError(`initialLye must be an integer >= 0, got ${initialLye}`);
    }
    this.clock = clock;
    this.maxBundles = maxBundles;
    this.registry = new BundleRegistry();
    this.ledger = new LyeLedger(initialLye);
  }

  soak(
    id: string,
    payload: unknown,
    soakAt: number,
    liftAt: number,
    cost = 1,
  ): SoakStatus {
    assertId(id);
    assertSpan(soakAt, liftAt);
    assertCost(cost);
    if (this.registry.has(id)) {
      this.registry.update(id, payload, soakAt, liftAt, cost);
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxBundles) {
      throw new CapacityError(`bundle capacity ${this.maxBundles} reached`);
    }
    this.registry.add(id, payload, soakAt, liftAt, cost);
    return { status: "accepted" };
  }

  resoak(id: string, soakAt: number, liftAt: number): boolean {
    assertId(id);
    assertSpan(soakAt, liftAt);
    if (!this.registry.has(id)) return false;
    this.registry.respan(id, soakAt, liftAt);
    return true;
  }

  pull(id: string): boolean {
    assertId(id);
    return this.registry.remove(id);
  }

  cork(id: string): boolean {
    this.requireKnown(id);
    this.registry.setCorked(id, true);
    return true;
  }

  uncork(id: string): boolean {
    this.requireKnown(id);
    this.registry.setCorked(id, false);
    return true;
  }

  isCorked(id: string): boolean {
    this.requireKnown(id);
    return this.registry.isCorked(id) === true;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  lye(): number {
    return this.ledger.lye();
  }

  peek(): BundleRecord | null {
    const [head] = this.registry.ripeEntries(this.clock.now());
    return head ? snapshotOf(head) : null;
  }

  pop(): BundleRecord | null {
    const candidates = this.registry.ripeEntries(this.clock.now());
    for (const candidate of candidates) {
      if (!this.ledger.canAfford(candidate.cost)) continue;
      this.registry.remove(candidate.id);
      this.ledger.spend(candidate.cost);
      return snapshotOf(candidate);
    }
    return null;
  }

  ripeIds(): string[] {
    return this.registry.ripeEntries(this.clock.now()).map((entry) => entry.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const lifted: BundleRecord[] = [];
    for (;;) {
      const candidates = this.registry.ripeEntries(now);
      const affordable = candidates.find((entry) => this.ledger.canAfford(entry.cost));
      if (!affordable) break;
      this.registry.remove(affordable.id);
      this.ledger.spend(affordable.cost);
      lifted.push(snapshotOf(affordable));
    }
    const spoiled: string[] = [];
    for (const entry of this.registry.spoiledEntries(now)) {
      this.registry.remove(entry.id);
      spoiled.push(entry.id);
    }
    return { lifted, spoiled };
  }

  ids(): string[] {
    return this.registry.all().map((entry) => entry.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { soakAt: number; liftAt: number } | null {
    assertId(id);
    const record = this.registry.get(id);
    return record ? { soakAt: record.soakAt, liftAt: record.liftAt } : null;
  }

  costOf(id: string): number | null {
    assertId(id);
    const record = this.registry.get(id);
    return record ? record.cost : null;
  }

  private requireKnown(id: string): void {
    assertId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown bundle id: ${id}`);
    }
  }
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`id must be a non-empty string, got ${String(id)}`);
  }
}

function assertSpan(soakAt: number, liftAt: number): void {
  if (
    !Number.isInteger(soakAt) ||
    !Number.isInteger(liftAt) ||
    soakAt < 0 ||
    liftAt < 0 ||
    liftAt <= soakAt
  ) {
    throw new InvalidSpanError(
      `span must be finite integers with 0 <= soakAt < liftAt, got [${soakAt}, ${liftAt}]`,
    );
  }
}

function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError(`cost must be a finite integer >= 1, got ${cost}`);
  }
}
