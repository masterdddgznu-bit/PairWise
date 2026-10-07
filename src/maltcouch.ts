import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidMistError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { MistLedger } from "./mistLedger.js";
import { HeapRecord, HeapRegistry } from "./registry.js";

export interface MaltCouchOptions {
  clock: VirtualClock;
  maxHeaps?: number;
  initialMist?: number;
}

export interface HeapSnapshot {
  id: string;
  payload: unknown;
  couchAt: number;
  kilnAt: number;
  mist: number;
}

export interface DriveResult {
  drawn: HeapSnapshot[];
  spent: string[];
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1;
}

function snapshotOf(record: HeapRecord): HeapSnapshot {
  return {
    id: record.id,
    payload: record.payload,
    couchAt: record.couchAt,
    kilnAt: record.kilnAt,
    mist: record.mist,
  };
}

export class MaltCouch {
  private readonly clock: VirtualClock;
  private readonly maxHeaps: number;
  private readonly registry = new HeapRegistry();
  private readonly ledger: MistLedger;

  constructor(options: MaltCouchOptions) {
    const maxHeaps = options.maxHeaps ?? 5;
    const initialMist = options.initialMist ?? 0;
    if (!isPositiveInt(maxHeaps) || !isNonNegativeInt(initialMist)) {
      throw new InvalidConfigError("maxHeaps must be an integer >= 1 and initialMist an integer >= 0");
    }
    this.clock = options.clock;
    this.maxHeaps = maxHeaps;
    this.ledger = new MistLedger(initialMist);
  }

  load(id: string, payload: unknown, couchAt: number, kilnAt: number, mist = 1): { status: "accepted" | "updated" } {
    this.assertValidId(id);
    this.assertValidSpan(couchAt, kilnAt);
    this.assertValidMist(mist);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.couchAt = couchAt;
      existing.kilnAt = kilnAt;
      existing.mist = mist;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxHeaps) {
      throw new CapacityError(`capacity ${this.maxHeaps} reached`);
    }
    this.registry.add(id, payload, couchAt, kilnAt, mist);
    return { status: "accepted" };
  }

  retune(id: string, couchAt: number, kilnAt: number): boolean {
    this.assertValidId(id);
    this.assertValidSpan(couchAt, kilnAt);
    const record = this.registry.get(id);
    if (!record) {
      return false;
    }
    record.couchAt = couchAt;
    record.kilnAt = kilnAt;
    record.sheeted = true;
    return true;
  }

  drop(id: string): boolean {
    this.assertValidId(id);
    return this.registry.remove(id);
  }

  sheet(id: string): boolean {
    this.requireRecord(id).sheeted = true;
    return true;
  }

  unsheet(id: string): boolean {
    this.requireRecord(id).sheeted = false;
    return true;
  }

  isSheeted(id: string): boolean {
    return this.requireRecord(id).sheeted;
  }

  grant(amount: number): number {
    if (!isPositiveInt(amount)) {
      throw new InvalidAmountError("grant amount must be a finite integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  mist(): number {
    return this.ledger.available();
  }

  peek(): HeapSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): HeapSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.mist)) {
      return null;
    }
    this.ledger.spend(head.mist);
    this.registry.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((record) => record.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: HeapSnapshot[] = [];
    for (const record of this.candidates(now)) {
      if (!this.ledger.canAfford(record.mist)) {
        break;
      }
      this.ledger.spend(record.mist);
      this.registry.remove(record.id);
      drawn.push(snapshotOf(record));
    }
    const spent: string[] = [];
    for (const record of this.registry.allInFirstLoadOrder()) {
      if (!record.sheeted && record.kilnAt <= now) {
        this.registry.remove(record.id);
        spent.push(record.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.idsInFirstLoadOrder();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { couchAt: number; kilnAt: number } | null {
    this.assertValidId(id);
    const record = this.registry.get(id);
    return record ? { couchAt: record.couchAt, kilnAt: record.kilnAt } : null;
  }

  mistOf(id: string): number | null {
    this.assertValidId(id);
    const record = this.registry.get(id);
    return record ? record.mist : null;
  }

  private candidates(now = this.clock.now()): HeapRecord[] {
    return this.registry
      .allInFirstLoadOrder()
      .filter((record) => !record.sheeted && record.couchAt < now && now < record.kilnAt)
      .sort((a, b) => a.kilnAt - b.kilnAt || a.mist - b.mist || a.seq - b.seq);
  }

  private requireRecord(id: string): HeapRecord {
    this.assertValidId(id);
    const record = this.registry.get(id);
    if (!record) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return record;
  }

  private assertValidId(id: unknown): asserts id is string {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private assertValidSpan(couchAt: number, kilnAt: number): void {
    if (!isNonNegativeInt(couchAt) || !isNonNegativeInt(kilnAt) || kilnAt <= couchAt) {
      throw new InvalidSpanError("couchAt/kilnAt must be finite integers >= 0 with kilnAt > couchAt");
    }
  }

  private assertValidMist(mist: number): void {
    if (!isPositiveInt(mist)) {
      throw new InvalidMistError("mist must be a finite integer >= 1");
    }
  }
}
