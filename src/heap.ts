import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidDueError,
  InvalidIdError,
  UnknownIdError,
} from "./errors.js";
import { CreditLedger } from "./ledger.js";
import { Registry, WorkItem } from "./registry.js";

export interface DueHeapOptions {
  clock: VirtualClock;
  maxItems?: number;
  initialCredit?: number;
}

export interface ItemView {
  id: string;
  payload: unknown;
  dueAt: number;
  cost: number;
}

const DEFAULT_MAX_ITEMS = 16;
const DEFAULT_INITIAL_CREDIT = 0;

function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`id must be a non-empty string, got ${String(id)}`);
  }
}

function validateDueAt(dueAt: unknown): asserts dueAt is number {
  if (typeof dueAt !== "number" || !Number.isInteger(dueAt) || dueAt < 0) {
    throw new InvalidDueError(`dueAt must be a finite integer >= 0, got ${String(dueAt)}`);
  }
}

function validateCost(cost: unknown): asserts cost is number {
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError(`cost must be a finite integer >= 1, got ${String(cost)}`);
  }
}

function toView(item: WorkItem): ItemView {
  return { id: item.id, payload: item.payload, dueAt: item.dueAt, cost: item.cost };
}

export class DueHeap {
  private readonly clock: VirtualClock;
  private readonly maxItems: number;
  private readonly ledger: CreditLedger;
  private readonly registry = new Registry();

  constructor(options: DueHeapOptions) {
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    const initialCredit = options.initialCredit ?? DEFAULT_INITIAL_CREDIT;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError(`maxItems must be an integer >= 1, got ${String(maxItems)}`);
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError(
        `initialCredit must be an integer >= 0, got ${String(initialCredit)}`,
      );
    }
    this.clock = options.clock;
    this.maxItems = maxItems;
    this.ledger = new CreditLedger(initialCredit);
  }

  schedule(
    id: string,
    payload: unknown,
    dueAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateDueAt(dueAt);
    validateCost(cost);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.dueAt = dueAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxItems) {
      throw new CapacityError(`capacity ${this.maxItems} reached`);
    }
    this.registry.add(id, payload, dueAt, cost);
    return { status: "accepted" };
  }

  reschedule(id: string, dueAt: number): boolean {
    validateId(id);
    validateDueAt(dueAt);
    const item = this.registry.get(id);
    if (!item) return false;
    item.dueAt = dueAt;
    return true;
  }

  cancel(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  freeze(id: string): boolean {
    validateId(id);
    this.requireItem(id).frozen = true;
    return true;
  }

  unfreeze(id: string): boolean {
    validateId(id);
    this.requireItem(id).frozen = false;
    return true;
  }

  isFrozen(id: string): boolean {
    validateId(id);
    return this.requireItem(id).frozen;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): ItemView | null {
    const candidates = this.readyItems(this.clock.now());
    return candidates.length === 0 ? null : toView(candidates[0]);
  }

  pop(): ItemView | null {
    const item = this.firstAffordable(this.clock.now());
    if (!item) return null;
    this.registry.remove(item.id);
    this.ledger.spend(item.cost);
    return toView(item);
  }

  readyIds(): string[] {
    return this.readyItems(this.clock.now()).map((item) => item.id);
  }

  drive(): { drained: ItemView[] } {
    const snapshotNow = this.clock.now();
    const drained: ItemView[] = [];
    for (;;) {
      const item = this.firstAffordable(snapshotNow);
      if (!item) break;
      this.registry.remove(item.id);
      this.ledger.spend(item.cost);
      drained.push(toView(item));
    }
    return { drained };
  }

  ids(): string[] {
    return this.registry.inOrder().map((item) => item.id);
  }

  size(): number {
    return this.registry.size();
  }

  dueOf(id: string): number | null {
    validateId(id);
    return this.registry.get(id)?.dueAt ?? null;
  }

  costOf(id: string): number | null {
    validateId(id);
    return this.registry.get(id)?.cost ?? null;
  }

  private requireItem(id: string): WorkItem {
    const item = this.registry.get(id);
    if (!item) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return item;
  }

  /** Due and unfrozen items, ordered by (dueAt, first-registration seq). */
  private readyItems(now: number): WorkItem[] {
    return this.registry
      .inOrder()
      .filter((item) => !item.frozen && item.dueAt <= now)
      .sort((a, b) => a.dueAt - b.dueAt || a.seq - b.seq);
  }

  private firstAffordable(now: number): WorkItem | null {
    for (const item of this.readyItems(now)) {
      if (this.ledger.canAfford(item.cost)) return item;
    }
    return null;
  }
}
