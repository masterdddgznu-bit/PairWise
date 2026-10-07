import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import { CreditLedger } from "./ledger.js";
import {
  CableRecord,
  CableRegistry,
  validateFlakes,
  validateId,
  validateSpan,
} from "./registry.js";
import { StopLatch } from "./stop-latch.js";

export interface CableTierOptions {
  clock: VirtualClock;
  maxCables?: number;
  initialCredit?: number;
}

export interface CableSnapshot {
  id: string;
  payload: unknown;
  stowAt: number;
  castAt: number;
  flakes: number;
}

export interface DriveResult {
  hauled: CableSnapshot[];
  spent: string[];
}

function snapshotOf(record: CableRecord): CableSnapshot {
  return {
    id: record.id,
    payload: record.payload,
    stowAt: record.stowAt,
    castAt: record.castAt,
    flakes: record.flakes,
  };
}

export class CableTier {
  private readonly clock: VirtualClock;
  private readonly maxCables: number;
  private readonly ledger: CreditLedger;
  private readonly registry = new CableRegistry();
  private readonly latch = new StopLatch();

  constructor(options: CableTierOptions) {
    const maxCables = options.maxCables ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxCables) || maxCables < 1) {
      throw new InvalidConfigError("maxCables must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxCables = maxCables;
    this.ledger = new CreditLedger(initialCredit);
  }

  seat(
    id: string,
    payload: unknown,
    stowAt: number,
    castAt: number,
    flakes = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(stowAt, castAt);
    validateFlakes(flakes);
    if (!this.registry.has(id) && this.registry.size >= this.maxCables) {
      throw new CapacityError("cable capacity reached");
    }
    const status = this.registry.seat(id, payload, stowAt, castAt, flakes);
    this.latch.engage(id);
    return { status };
  }

  resplice(id: string, stowAt: number, castAt: number): boolean {
    validateId(id);
    validateSpan(stowAt, castAt);
    const record = this.registry.get(id);
    if (!record) {
      return false;
    }
    record.stowAt = stowAt;
    record.castAt = castAt;
    this.latch.release(id);
    return true;
  }

  scrap(id: string): boolean {
    validateId(id);
    if (!this.registry.delete(id)) {
      return false;
    }
    this.latch.forget(id);
    return true;
  }

  stop(id: string): boolean {
    this.requireKnown(id);
    this.latch.engage(id);
    return true;
  }

  unstop(id: string): boolean {
    this.requireKnown(id);
    this.latch.release(id);
    return true;
  }

  isStopped(id: string): boolean {
    this.requireKnown(id);
    return this.latch.isStopped(id);
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): CableSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  haul(): CableSnapshot | null {
    const head = this.candidates()[0];
    if (!head) {
      return null;
    }
    const cost = head.castAt - head.stowAt;
    if (!this.ledger.canAfford(cost)) {
      return null;
    }
    this.ledger.spend(cost);
    head.flakes -= 1;
    const snapshot = snapshotOf(head);
    if (head.flakes === 0) {
      this.registry.delete(head.id);
      this.latch.forget(head.id);
    }
    return snapshot;
  }

  liveIds(): string[] {
    return this.candidates().map((record) => record.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const record of this.registry.inFirstAdmitOrder()) {
      if (now >= record.castAt && !this.latch.isStopped(record.id)) {
        this.registry.delete(record.id);
        this.latch.forget(record.id);
        spent.push(record.id);
      }
    }
    const hauled: CableSnapshot[] = [];
    for (;;) {
      const snapshot = this.haul();
      if (!snapshot) {
        break;
      }
      hauled.push(snapshot);
    }
    return { hauled, spent };
  }

  ids(): string[] {
    return this.registry.inFirstAdmitOrder().map((record) => record.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { stowAt: number; castAt: number } | null {
    validateId(id);
    const record = this.registry.get(id);
    return record ? { stowAt: record.stowAt, castAt: record.castAt } : null;
  }

  flakesOf(id: string): number | null {
    validateId(id);
    const record = this.registry.get(id);
    return record ? record.flakes : null;
  }

  private requireKnown(id: string): void {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown cable id: ${id}`);
    }
  }

  private candidates(): CableRecord[] {
    const now = this.clock.now();
    return this.registry
      .inFirstAdmitOrder()
      .filter(
        (record) =>
          !this.latch.isStopped(record.id) &&
          record.stowAt < now &&
          now < record.castAt &&
          record.flakes >= 1,
      )
      .sort(
        (a, b) => b.castAt - a.castAt || a.flakes - b.flakes || a.seq - b.seq,
      );
  }
}
