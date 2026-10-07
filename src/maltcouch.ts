import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidMistError,
  UnknownIdError,
} from "./errors.js";
import { MistLedger } from "./mist-ledger.js";
import {
  assertValidId,
  assertValidSpan,
  compareForDraw,
  HeapRecord,
  HeapRegistry,
} from "./registry.js";
import { SheetGate } from "./sheet-gate.js";

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
  private readonly ledger: MistLedger;
  private readonly registry = new HeapRegistry();
  private readonly gate = new SheetGate();

  constructor(options: MaltCouchOptions) {
    const maxHeaps = options.maxHeaps ?? 5;
    const initialMist = options.initialMist ?? 0;
    if (!Number.isInteger(maxHeaps) || maxHeaps < 1) {
      throw new InvalidConfigError("maxHeaps must be an integer >= 1");
    }
    if (!Number.isInteger(initialMist) || initialMist < 0) {
      throw new InvalidConfigError("initialMist must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxHeaps = maxHeaps;
    this.ledger = new MistLedger(initialMist);
  }

  load(
    id: string,
    payload: unknown,
    couchAt: number,
    kilnAt: number,
    mist = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(couchAt, kilnAt);
    if (!Number.isInteger(mist) || mist < 1) {
      throw new InvalidMistError("mist must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.couchAt = couchAt;
      existing.kilnAt = kilnAt;
      existing.mist = mist;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxHeaps) {
      throw new CapacityError("malt couch is at capacity");
    }
    this.registry.add(id, payload, couchAt, kilnAt, mist);
    this.gate.sheet(id);
    return { status: "accepted" };
  }

  retune(id: string, couchAt: number, kilnAt: number): boolean {
    assertValidId(id);
    assertValidSpan(couchAt, kilnAt);
    const record = this.registry.get(id);
    if (!record) return false;
    record.couchAt = couchAt;
    record.kilnAt = kilnAt;
    this.gate.sheet(id);
    return true;
  }

  drop(id: string): boolean {
    assertValidId(id);
    if (!this.registry.remove(id)) return false;
    this.gate.forget(id);
    return true;
  }

  sheet(id: string): boolean {
    this.requireKnown(id);
    this.gate.sheet(id);
    return true;
  }

  unsheet(id: string): boolean {
    this.requireKnown(id);
    this.gate.unsheet(id);
    return true;
  }

  isSheeted(id: string): boolean {
    this.requireKnown(id);
    return this.gate.isSheeted(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  mist(): number {
    return this.ledger.available();
  }

  peek(): HeapSnapshot | null {
    const head = this.rankedCandidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): HeapSnapshot | null {
    const head = this.rankedCandidates(this.clock.now())[0];
    if (!head || !this.ledger.canAfford(head.mist)) return null;
    this.ledger.spend(head.mist);
    this.registry.remove(head.id);
    this.gate.forget(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.rankedCandidates(this.clock.now()).map((h) => h.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: HeapSnapshot[] = [];
    for (const candidate of this.rankedCandidates(now)) {
      if (!this.ledger.canAfford(candidate.mist)) break;
      this.ledger.spend(candidate.mist);
      this.registry.remove(candidate.id);
      this.gate.forget(candidate.id);
      drawn.push(snapshotOf(candidate));
    }
    const spent: string[] = [];
    for (const record of this.registry.allInFirstLoadOrder()) {
      if (now >= record.kilnAt && !this.gate.isSheeted(record.id)) {
        this.registry.remove(record.id);
        this.gate.forget(record.id);
        spent.push(record.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.allInFirstLoadOrder().map((h) => h.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { couchAt: number; kilnAt: number } | null {
    assertValidId(id);
    const record = this.registry.get(id);
    if (!record) return null;
    return { couchAt: record.couchAt, kilnAt: record.kilnAt };
  }

  mistOf(id: string): number | null {
    assertValidId(id);
    const record = this.registry.get(id);
    return record ? record.mist : null;
  }

  private requireKnown(id: string): void {
    assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown heap id: ${id}`);
    }
  }

  private rankedCandidates(now: number): HeapRecord[] {
    return this.registry
      .allInFirstLoadOrder()
      .filter(
        (h) =>
          h.couchAt < now && now < h.kilnAt && !this.gate.isSheeted(h.id),
      )
      .sort(compareForDraw);
  }
}
