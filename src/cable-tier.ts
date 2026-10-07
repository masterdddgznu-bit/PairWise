import type { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidFlakesError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { CreditLedger } from "./ledger.js";
import { StopGate } from "./gate.js";

export interface CableSnapshot {
  id: string;
  payload: unknown;
  stowAt: number;
  castAt: number;
  flakes: number;
}

interface CableRecord {
  id: string;
  payload: unknown;
  stowAt: number;
  castAt: number;
  flakes: number;
  seq: number;
}

export interface CableTierOptions {
  clock: VirtualClock;
  maxCables?: number;
  initialCredit?: number;
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(stowAt: number, castAt: number): void {
  if (
    !Number.isInteger(stowAt) ||
    !Number.isInteger(castAt) ||
    stowAt < 0 ||
    castAt < 0 ||
    castAt <= stowAt
  ) {
    throw new InvalidSpanError(
      "stowAt/castAt must be integers >= 0 with castAt > stowAt",
    );
  }
}

function assertValidFlakes(flakes: number): void {
  if (!Number.isInteger(flakes) || flakes < 1) {
    throw new InvalidFlakesError("flakes must be an integer >= 1");
  }
}

export class CableTier {
  #clock: VirtualClock;
  #maxCables: number;
  #ledger: CreditLedger;
  #gate = new StopGate();
  #cables = new Map<string, CableRecord>();
  #nextSeq = 0;

  constructor(options: CableTierOptions) {
    const maxCables = options.maxCables ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxCables) || maxCables < 1) {
      throw new InvalidConfigError("maxCables must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.#clock = options.clock;
    this.#maxCables = maxCables;
    this.#ledger = new CreditLedger(initialCredit);
  }

  seat(
    id: string,
    payload: unknown,
    stowAt: number,
    castAt: number,
    flakes = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(stowAt, castAt);
    assertValidFlakes(flakes);
    const existing = this.#cables.get(id);
    if (existing) {
      existing.payload = payload;
      existing.stowAt = stowAt;
      existing.castAt = castAt;
      existing.flakes = flakes;
      this.#gate.arm(id);
      return { status: "updated" };
    }
    if (this.#cables.size >= this.#maxCables) {
      throw new CapacityError("cable capacity reached");
    }
    this.#cables.set(id, {
      id,
      payload,
      stowAt,
      castAt,
      flakes,
      seq: this.#nextSeq++,
    });
    this.#gate.arm(id);
    return { status: "accepted" };
  }

  resplice(id: string, stowAt: number, castAt: number): boolean {
    assertValidSpan(stowAt, castAt);
    const record = this.#cables.get(id);
    if (!record) {
      return false;
    }
    record.stowAt = stowAt;
    record.castAt = castAt;
    this.#gate.release(id);
    return true;
  }

  scrap(id: string): boolean {
    assertValidId(id);
    if (!this.#cables.delete(id)) {
      return false;
    }
    this.#gate.forget(id);
    return true;
  }

  stop(id: string): boolean {
    this.#requireKnown(id);
    this.#gate.arm(id);
    return true;
  }

  unstop(id: string): boolean {
    this.#requireKnown(id);
    this.#gate.release(id);
    return true;
  }

  isStopped(id: string): boolean {
    this.#requireKnown(id);
    return this.#gate.isStopped(id);
  }

  endow(amount: number): number {
    return this.#ledger.endow(amount);
  }

  credit(): number {
    return this.#ledger.balance();
  }

  peek(): CableSnapshot | null {
    const head = this.#candidates()[0];
    return head ? this.#snapshot(head) : null;
  }

  haul(): CableSnapshot | null {
    const head = this.#candidates()[0];
    if (!head) {
      return null;
    }
    const cost = head.castAt - head.stowAt;
    if (!this.#ledger.canAfford(cost)) {
      return null;
    }
    this.#ledger.spend(cost);
    head.flakes -= 1;
    const result = this.#snapshot(head);
    if (head.flakes === 0) {
      this.#cables.delete(head.id);
      this.#gate.forget(head.id);
    }
    return result;
  }

  liveIds(): string[] {
    return this.#candidates().map((record) => record.id);
  }

  drive(): { hauled: CableSnapshot[]; spent: string[] } {
    const now = this.#clock.now();
    const spent: string[] = [];
    for (const record of [...this.#cables.values()].sort(
      (a, b) => a.seq - b.seq,
    )) {
      if (!this.#gate.isStopped(record.id) && now >= record.castAt) {
        this.#cables.delete(record.id);
        this.#gate.forget(record.id);
        spent.push(record.id);
      }
    }
    const hauled: CableSnapshot[] = [];
    for (;;) {
      const result = this.#haulAt(now);
      if (!result) {
        break;
      }
      hauled.push(result);
    }
    return { hauled, spent };
  }

  ids(): string[] {
    return [...this.#cables.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((record) => record.id);
  }

  size(): number {
    return this.#cables.size;
  }

  spanOf(id: string): { stowAt: number; castAt: number } | null {
    assertValidId(id);
    const record = this.#cables.get(id);
    return record
      ? { stowAt: record.stowAt, castAt: record.castAt }
      : null;
  }

  flakesOf(id: string): number | null {
    assertValidId(id);
    return this.#cables.get(id)?.flakes ?? null;
  }

  #requireKnown(id: string): void {
    assertValidId(id);
    if (!this.#cables.has(id)) {
      throw new UnknownIdError(`unknown cable id: ${id}`);
    }
  }

  #haulAt(now: number): CableSnapshot | null {
    const head = this.#candidates(now)[0];
    if (!head) {
      return null;
    }
    const cost = head.castAt - head.stowAt;
    if (!this.#ledger.canAfford(cost)) {
      return null;
    }
    this.#ledger.spend(cost);
    head.flakes -= 1;
    const result = this.#snapshot(head);
    if (head.flakes === 0) {
      this.#cables.delete(head.id);
      this.#gate.forget(head.id);
    }
    return result;
  }

  #candidates(now: number = this.#clock.now()): CableRecord[] {
    return [...this.#cables.values()]
      .filter(
        (record) =>
          !this.#gate.isStopped(record.id) &&
          record.flakes >= 1 &&
          record.stowAt < now &&
          now < record.castAt,
      )
      .sort(
        (a, b) =>
          b.castAt - a.castAt || a.flakes - b.flakes || a.seq - b.seq,
      );
  }

  #snapshot(record: CableRecord): CableSnapshot {
    return {
      id: record.id,
      payload: record.payload,
      stowAt: record.stowAt,
      castAt: record.castAt,
      flakes: record.flakes,
    };
  }
}
