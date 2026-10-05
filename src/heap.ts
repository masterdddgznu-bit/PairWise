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

export interface DueHeapOptions {
  clock: VirtualClock;
  maxItems?: number;
  initialCredit?: number;
}

export interface WorkItem {
  id: string;
  payload: unknown;
  dueAt: number;
  cost: number;
}

interface Entry extends WorkItem {
  frozen: boolean;
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidDue(dueAt: unknown): asserts dueAt is number {
  if (typeof dueAt !== "number" || !Number.isInteger(dueAt) || dueAt < 0) {
    throw new InvalidDueError("dueAt must be a finite integer >= 0");
  }
}

function assertValidCost(cost: unknown): asserts cost is number {
  if (typeof cost !== "number" || !Number.isInteger(cost) || (cost as number) < 1) {
    throw new InvalidCostError("cost must be a finite integer >= 1");
  }
}

export class DueHeap {
  private readonly clock: VirtualClock;
  private readonly maxItems: number;
  private readonly ledger: CreditLedger;
  private readonly entries = new Map<string, Entry>();

  constructor(options: DueHeapOptions) {
    const { clock, maxItems = 16, initialCredit = 0 } = options;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = clock;
    this.maxItems = maxItems;
    this.ledger = new CreditLedger(initialCredit);
  }

  schedule(
    id: string,
    payload: unknown,
    dueAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidDue(dueAt);
    assertValidCost(cost);
    const existing = this.entries.get(id);
    if (existing) {
      existing.payload = payload;
      existing.dueAt = dueAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.entries.size >= this.maxItems) {
      throw new CapacityError("heap is at capacity");
    }
    this.entries.set(id, { id, payload, dueAt, cost, frozen: false });
    return { status: "accepted" };
  }

  reschedule(id: string, dueAt: number): boolean {
    assertValidId(id);
    assertValidDue(dueAt);
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }
    entry.dueAt = dueAt;
    return true;
  }

  cancel(id: string): boolean {
    assertValidId(id);
    return this.entries.delete(id);
  }

  freeze(id: string): boolean {
    this.requireEntry(id).frozen = true;
    return true;
  }

  unfreeze(id: string): boolean {
    this.requireEntry(id).frozen = false;
    return true;
  }

  isFrozen(id: string): boolean {
    return this.requireEntry(id).frozen;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): WorkItem | null {
    const candidates = this.readyEntries(this.clock.now());
    return candidates.length === 0 ? null : this.toWorkItem(candidates[0]);
  }

  pop(): WorkItem | null {
    const taken = this.takeAffordable(this.clock.now());
    return taken ? this.toWorkItem(taken) : null;
  }

  readyIds(): string[] {
    return this.readyEntries(this.clock.now()).map((entry) => entry.id);
  }

  drive(): { drained: WorkItem[] } {
    const snapshotNow = this.clock.now();
    const drained: WorkItem[] = [];
    for (;;) {
      const taken = this.takeAffordable(snapshotNow);
      if (!taken) {
        break;
      }
      drained.push(this.toWorkItem(taken));
    }
    return { drained };
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  size(): number {
    return this.entries.size;
  }

  dueOf(id: string): number | null {
    assertValidId(id);
    return this.entries.get(id)?.dueAt ?? null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    return this.entries.get(id)?.cost ?? null;
  }

  private requireEntry(id: string): Entry {
    assertValidId(id);
    const entry = this.entries.get(id);
    if (!entry) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return entry;
  }

  private readyEntries(now: number): Entry[] {
    const ready: Entry[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.frozen && entry.dueAt <= now) {
        ready.push(entry);
      }
    }
    ready.sort((a, b) => a.dueAt - b.dueAt);
    return ready;
  }

  private takeAffordable(now: number): Entry | null {
    for (const entry of this.readyEntries(now)) {
      if (this.ledger.canAfford(entry.cost)) {
        this.entries.delete(entry.id);
        this.ledger.spend(entry.cost);
        return entry;
      }
    }
    return null;
  }

  private toWorkItem(entry: Entry): WorkItem {
    return {
      id: entry.id,
      payload: entry.payload,
      dueAt: entry.dueAt,
      cost: entry.cost,
    };
  }
}
