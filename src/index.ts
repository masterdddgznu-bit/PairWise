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
import { Registry, viewOf, type ItemView, type WorkItem } from "./registry.js";
import { StampLedger } from "./stamps.js";

export { VirtualClock } from "./clock.js";
export {
  SpanFuseError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidCostError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

export interface SpanFuseOptions {
  clock: VirtualClock;
  maxItems?: number;
  initialStamps?: number;
}

export interface DriveResult {
  taken: ItemView[];
  purged: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(readyAt: unknown, expireAt: unknown): void {
  const ok = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
  if (!ok(readyAt) || !ok(expireAt) || expireAt <= readyAt) {
    throw new InvalidSpanError(
      "readyAt/expireAt must be finite integers >= 0 with expireAt > readyAt",
    );
  }
}

function assertValidCost(cost: unknown): asserts cost is number {
  if (
    typeof cost !== "number" ||
    !Number.isFinite(cost) ||
    !Number.isInteger(cost) ||
    cost < 1
  ) {
    throw new InvalidCostError("cost must be a finite integer >= 1");
  }
}

export class SpanFuse {
  private readonly clock: VirtualClock;
  private readonly maxItems: number;
  private readonly registry = new Registry();
  private readonly ledger: StampLedger;

  constructor(options: SpanFuseOptions) {
    const maxItems = options.maxItems ?? 16;
    const initialStamps = options.initialStamps ?? 0;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    if (!Number.isInteger(initialStamps) || initialStamps < 0) {
      throw new InvalidConfigError("initialStamps must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxItems = maxItems;
    this.ledger = new StampLedger(initialStamps);
  }

  arm(
    id: string,
    payload: unknown,
    readyAt: number,
    expireAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(readyAt, expireAt);
    assertValidCost(cost);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.readyAt = readyAt;
      existing.expireAt = expireAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxItems) {
      throw new CapacityError("registry is at capacity");
    }
    this.registry.add({ id, payload, readyAt, expireAt, cost });
    return { status: "accepted" };
  }

  rearm(id: string, readyAt: number, expireAt: number): boolean {
    assertValidId(id);
    assertValidSpan(readyAt, expireAt);
    const item = this.registry.get(id);
    if (!item) return false;
    item.readyAt = readyAt;
    item.expireAt = expireAt;
    return true;
  }

  cancel(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  fuse(id: string): boolean {
    this.known(id).fused = true;
    return true;
  }

  unfuse(id: string): boolean {
    this.known(id).fused = false;
    return true;
  }

  isFused(id: string): boolean {
    return this.known(id).fused;
  }

  grant(amount: number): number {
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      !Number.isInteger(amount) ||
      amount < 1
    ) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  stamps(): number {
    return this.ledger.available();
  }

  peek(): ItemView | null {
    const [head] = this.registry.candidates(this.clock.now());
    return head ? viewOf(head) : null;
  }

  pop(): ItemView | null {
    const item = this.firstAffordable(
      this.registry.candidates(this.clock.now()),
    );
    if (!item) return null;
    this.ledger.spend(item.cost);
    this.registry.remove(item.id);
    return viewOf(item);
  }

  liveIds(): string[] {
    return this.registry.candidates(this.clock.now()).map((item) => item.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const taken: ItemView[] = [];
    for (;;) {
      const item = this.firstAffordable(this.registry.candidates(now));
      if (!item) break;
      this.ledger.spend(item.cost);
      this.registry.remove(item.id);
      taken.push(viewOf(item));
    }
    const purged: string[] = [];
    for (const item of this.registry.all()) {
      if (!item.fused && now >= item.expireAt) {
        this.registry.remove(item.id);
        purged.push(item.id);
      }
    }
    return { taken, purged };
  }

  ids(): string[] {
    return this.registry.all().map((item) => item.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { readyAt: number; expireAt: number } | null {
    assertValidId(id);
    const item = this.registry.get(id);
    return item ? { readyAt: item.readyAt, expireAt: item.expireAt } : null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    return this.registry.get(id)?.cost ?? null;
  }

  private known(id: string): WorkItem {
    assertValidId(id);
    const item = this.registry.get(id);
    if (!item) throw new UnknownIdError(`unknown id: ${id}`);
    return item;
  }

  private firstAffordable(candidates: WorkItem[]): WorkItem | undefined {
    return candidates.find((item) => this.ledger.canAfford(item.cost));
  }
}
