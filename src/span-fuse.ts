import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { StampLedger } from "./ledger.js";

export interface WorkItemView {
  id: string;
  payload: unknown;
  readyAt: number;
  expireAt: number;
  cost: number;
}

interface WorkItem extends WorkItemView {
  seq: number;
  fused: boolean;
}

export interface SpanFuseOptions {
  clock: VirtualClock;
  maxItems?: number;
  initialStamps?: number;
}

const DEFAULT_MAX_ITEMS = 16;

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(readyAt: number, expireAt: number): void {
  if (
    !Number.isInteger(readyAt) ||
    !Number.isInteger(expireAt) ||
    readyAt < 0 ||
    expireAt < 0 ||
    expireAt <= readyAt
  ) {
    throw new InvalidSpanError(
      "readyAt/expireAt must be integers >= 0 with expireAt > readyAt",
    );
  }
}

function viewOf(item: WorkItem): WorkItemView {
  return {
    id: item.id,
    payload: item.payload,
    readyAt: item.readyAt,
    expireAt: item.expireAt,
    cost: item.cost,
  };
}

export class SpanFuse {
  readonly #clock: VirtualClock;
  readonly #maxItems: number;
  readonly #ledger: StampLedger;
  readonly #items = new Map<string, WorkItem>();
  #nextSeq = 0;

  constructor(options: SpanFuseOptions) {
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    const initialStamps = options.initialStamps ?? 0;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    if (!Number.isInteger(initialStamps) || initialStamps < 0) {
      throw new InvalidConfigError("initialStamps must be an integer >= 0");
    }
    this.#clock = options.clock;
    this.#maxItems = maxItems;
    this.#ledger = new StampLedger(initialStamps);
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
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const existing = this.#items.get(id);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.readyAt = readyAt;
      existing.expireAt = expireAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.#items.size >= this.#maxItems) {
      throw new CapacityError("registry is at capacity");
    }
    this.#items.set(id, {
      id,
      payload,
      readyAt,
      expireAt,
      cost,
      seq: this.#nextSeq++,
      fused: false,
    });
    return { status: "accepted" };
  }

  rearm(id: string, readyAt: number, expireAt: number): boolean {
    assertValidSpan(readyAt, expireAt);
    const item = this.#items.get(id);
    if (item === undefined) {
      return false;
    }
    item.readyAt = readyAt;
    item.expireAt = expireAt;
    return true;
  }

  cancel(id: string): boolean {
    assertValidId(id);
    return this.#items.delete(id);
  }

  fuse(id: string): boolean {
    this.#require(id).fused = true;
    return true;
  }

  unfuse(id: string): boolean {
    this.#require(id).fused = false;
    return true;
  }

  isFused(id: string): boolean {
    return this.#require(id).fused;
  }

  grant(amount: number): number {
    return this.#ledger.grant(amount);
  }

  stamps(): number {
    return this.#ledger.balance();
  }

  peek(): WorkItemView | null {
    const candidates = this.#candidates(this.#clock.now());
    return candidates.length === 0 ? null : viewOf(candidates[0]);
  }

  pop(): WorkItemView | null {
    const taken = this.#takeFirst(this.#clock.now());
    return taken === null ? null : viewOf(taken);
  }

  liveIds(): string[] {
    return this.#candidates(this.#clock.now()).map((item) => item.id);
  }

  drive(): { taken: WorkItemView[]; purged: string[] } {
    const now = this.#clock.now();
    const taken: WorkItemView[] = [];
    for (;;) {
      const item = this.#takeFirst(now);
      if (item === null) {
        break;
      }
      taken.push(viewOf(item));
    }
    const purged: string[] = [];
    for (const item of this.#bySeq()) {
      if (!item.fused && now >= item.expireAt) {
        this.#items.delete(item.id);
        purged.push(item.id);
      }
    }
    return { taken, purged };
  }

  ids(): string[] {
    return this.#bySeq().map((item) => item.id);
  }

  size(): number {
    return this.#items.size;
  }

  spanOf(id: string): { readyAt: number; expireAt: number } | null {
    assertValidId(id);
    const item = this.#items.get(id);
    return item === undefined
      ? null
      : { readyAt: item.readyAt, expireAt: item.expireAt };
  }

  costOf(id: string): number | null {
    assertValidId(id);
    const item = this.#items.get(id);
    return item === undefined ? null : item.cost;
  }

  #require(id: string): WorkItem {
    assertValidId(id);
    const item = this.#items.get(id);
    if (item === undefined) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return item;
  }

  #bySeq(): WorkItem[] {
    return [...this.#items.values()].sort((a, b) => a.seq - b.seq);
  }

  #candidates(now: number): WorkItem[] {
    return [...this.#items.values()]
      .filter(
        (item) =>
          !item.fused && item.readyAt <= now && now < item.expireAt,
      )
      .sort((a, b) => a.expireAt - b.expireAt || a.seq - b.seq);
  }

  #takeFirst(now: number): WorkItem | null {
    for (const item of this.#candidates(now)) {
      if (this.#ledger.canAfford(item.cost)) {
        this.#items.delete(item.id);
        this.#ledger.spend(item.cost);
        return item;
      }
    }
    return null;
  }
}
