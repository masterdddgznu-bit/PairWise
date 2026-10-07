import { VirtualClock } from "./clock.js";
import { TineLedger } from "./ledger.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface RickDescriptor {
  id: string;
  payload: unknown;
  stackAt: number;
  forkAt: number;
  cost: number;
}

interface RickEntry extends RickDescriptor {
  seq: number;
  sheeted: boolean;
}

export interface HayRickOptions {
  clock: VirtualClock;
  maxRicks?: number;
  initialTines?: number;
}

export interface DriveResult {
  lifted: RickDescriptor[];
  spoiled: string[];
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isValidSpan(stackAt: unknown, forkAt: unknown): boolean {
  return (
    Number.isInteger(stackAt) &&
    Number.isInteger(forkAt) &&
    (stackAt as number) >= 0 &&
    (forkAt as number) >= 0 &&
    (forkAt as number) > (stackAt as number)
  );
}

function isValidCost(cost: unknown): boolean {
  return Number.isInteger(cost) && (cost as number) >= 1;
}

function describe(entry: RickEntry): RickDescriptor {
  return {
    id: entry.id,
    payload: entry.payload,
    stackAt: entry.stackAt,
    forkAt: entry.forkAt,
    cost: entry.cost,
  };
}

export class HayRick {
  private readonly clock: VirtualClock;
  private readonly maxRicks: number;
  private readonly ledger: TineLedger;
  private readonly ricks = new Map<string, RickEntry>();
  private nextSeq = 0;

  constructor(options: HayRickOptions) {
    if (!options || !(options.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    const maxRicks = options.maxRicks ?? 5;
    const initialTines = options.initialTines ?? 0;
    if (!Number.isInteger(maxRicks) || maxRicks < 1) {
      throw new InvalidConfigError("maxRicks must be an integer >= 1");
    }
    if (!Number.isInteger(initialTines) || initialTines < 0) {
      throw new InvalidConfigError("initialTines must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxRicks = maxRicks;
    this.ledger = new TineLedger(initialTines);
  }

  stack(
    id: string,
    payload: unknown,
    stackAt: number,
    forkAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    if (!isValidSpan(stackAt, forkAt)) {
      throw new InvalidSpanError(
        "stackAt/forkAt must be integers >= 0 with forkAt > stackAt",
      );
    }
    if (!isValidCost(cost)) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const existing = this.ricks.get(id);
    if (existing) {
      existing.payload = payload;
      existing.stackAt = stackAt;
      existing.forkAt = forkAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.ricks.size >= this.maxRicks) {
      throw new CapacityError("rick registry is at capacity");
    }
    this.ricks.set(id, {
      id,
      payload,
      stackAt,
      forkAt,
      cost,
      seq: this.nextSeq++,
      sheeted: false,
    });
    return { status: "accepted" };
  }

  restack(id: string, stackAt: number, forkAt: number): boolean {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    if (!isValidSpan(stackAt, forkAt)) {
      throw new InvalidSpanError(
        "stackAt/forkAt must be integers >= 0 with forkAt > stackAt",
      );
    }
    const entry = this.ricks.get(id);
    if (!entry) {
      return false;
    }
    entry.stackAt = stackAt;
    entry.forkAt = forkAt;
    return true;
  }

  yank(id: string): boolean {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    return this.ricks.delete(id);
  }

  sheet(id: string): boolean {
    this.requireEntry(id).sheeted = true;
    return true;
  }

  unsheet(id: string): boolean {
    this.requireEntry(id).sheeted = false;
    return true;
  }

  isSheeted(id: string): boolean {
    return this.requireEntry(id).sheeted;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  tines(): number {
    return this.ledger.available();
  }

  peek(): RickDescriptor | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? describe(head) : null;
  }

  pop(): RickDescriptor | null {
    const head = this.candidates(this.clock.now())[0];
    if (!head || !this.ledger.canAfford(head.cost)) {
      return null;
    }
    this.ledger.spend(head.cost);
    this.ricks.delete(head.id);
    return describe(head);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((entry) => entry.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const lifted: RickDescriptor[] = [];
    for (const entry of this.candidates(now)) {
      if (!this.ledger.canAfford(entry.cost)) {
        break;
      }
      if (!this.ricks.has(entry.id)) {
        continue;
      }
      this.ledger.spend(entry.cost);
      this.ricks.delete(entry.id);
      lifted.push(describe(entry));
    }
    const spoiled: string[] = [];
    const remaining = [...this.ricks.values()].sort((a, b) => a.seq - b.seq);
    for (const entry of remaining) {
      if (!entry.sheeted && now >= entry.forkAt) {
        this.ricks.delete(entry.id);
        spoiled.push(entry.id);
      }
    }
    return { lifted, spoiled };
  }

  ids(): string[] {
    return [...this.ricks.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((entry) => entry.id);
  }

  size(): number {
    return this.ricks.size;
  }

  spanOf(id: string): { stackAt: number; forkAt: number } | null {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    const entry = this.ricks.get(id);
    return entry ? { stackAt: entry.stackAt, forkAt: entry.forkAt } : null;
  }

  costOf(id: string): number | null {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    const entry = this.ricks.get(id);
    return entry ? entry.cost : null;
  }

  private requireEntry(id: string): RickEntry {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    const entry = this.ricks.get(id);
    if (!entry) {
      throw new UnknownIdError(`unknown rick id: ${id}`);
    }
    return entry;
  }

  private candidates(now: number): RickEntry[] {
    return [...this.ricks.values()]
      .filter(
        (entry) =>
          !entry.sheeted && entry.stackAt <= now && now < entry.forkAt,
      )
      .sort((a, b) => b.forkAt - a.forkAt || a.cost - b.cost || a.seq - b.seq);
  }
}
