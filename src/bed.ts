import { VirtualClock } from "./clock.js";
import { GravityLedger } from "./ledger.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidGravityError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface LotSnapshot {
  id: string;
  payload: unknown;
  mashAt: number;
  runoffAt: number;
  gravity: number;
}

interface Lot extends LotSnapshot {
  gated: boolean;
  seq: number;
}

export interface LauterBedOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialGravity?: number;
}

export class LauterBed {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly ledger: GravityLedger;
  private readonly lots = new Map<string, Lot>();
  private nextSeq = 0;

  constructor(options: LauterBedOptions) {
    const maxLots = options?.maxLots ?? 5;
    const initialGravity = options?.initialGravity ?? 0;
    if (
      !options ||
      !(options.clock instanceof VirtualClock) ||
      !Number.isInteger(maxLots) ||
      maxLots < 1 ||
      !Number.isInteger(initialGravity) ||
      initialGravity < 0
    ) {
      throw new InvalidConfigError(
        "clock is required; maxLots must be an integer >= 1; initialGravity an integer >= 0",
      );
    }
    this.clock = options.clock;
    this.maxLots = maxLots;
    this.ledger = new GravityLedger(initialGravity);
  }

  load(
    id: string,
    payload: unknown,
    mashAt: number,
    runoffAt: number,
    gravity = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(mashAt, runoffAt);
    assertValidGravity(gravity);
    const existing = this.lots.get(id);
    if (existing) {
      existing.payload = payload;
      existing.mashAt = mashAt;
      existing.runoffAt = runoffAt;
      existing.gravity = gravity;
      existing.gated = false;
      return { status: "updated" };
    }
    if (this.lots.size >= this.maxLots) {
      throw new CapacityError(`lauter bed is full (${this.maxLots} lots)`);
    }
    this.lots.set(id, {
      id,
      payload,
      mashAt,
      runoffAt,
      gravity,
      gated: false,
      seq: this.nextSeq++,
    });
    return { status: "accepted" };
  }

  recock(id: string, mashAt: number, runoffAt: number): boolean {
    assertValidId(id);
    assertValidSpan(mashAt, runoffAt);
    const lot = this.lots.get(id);
    if (!lot) return false;
    lot.mashAt = mashAt;
    lot.runoffAt = runoffAt;
    return true;
  }

  dump(id: string): boolean {
    assertValidId(id);
    return this.lots.delete(id);
  }

  gate(id: string): boolean {
    this.requireLot(id).gated = true;
    return true;
  }

  ungate(id: string): boolean {
    this.requireLot(id).gated = false;
    return true;
  }

  isGated(id: string): boolean {
    return this.requireLot(id).gated;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  gravity(): number {
    return this.ledger.available();
  }

  peek(): LotSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): LotSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.gravity)) return null;
    this.ledger.spend(head.gravity);
    this.lots.delete(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((lot) => lot.id);
  }

  drive(): { drawn: LotSnapshot[]; stale: string[] } {
    const now = this.clock.now();
    const stale: string[] = [];
    for (const lot of this.lots.values()) {
      if (!lot.gated && now > lot.runoffAt) {
        stale.push(lot.id);
      }
    }
    for (const id of stale) {
      this.lots.delete(id);
    }
    const drawn: LotSnapshot[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (!head || !this.ledger.canAfford(head.gravity)) break;
      this.ledger.spend(head.gravity);
      this.lots.delete(head.id);
      drawn.push(snapshotOf(head));
    }
    return { drawn, stale };
  }

  ids(): string[] {
    return [...this.lots.keys()];
  }

  size(): number {
    return this.lots.size;
  }

  spanOf(id: string): { mashAt: number; runoffAt: number } | null {
    assertValidId(id);
    const lot = this.lots.get(id);
    return lot ? { mashAt: lot.mashAt, runoffAt: lot.runoffAt } : null;
  }

  gravityOf(id: string): number | null {
    assertValidId(id);
    return this.lots.get(id)?.gravity ?? null;
  }

  private requireLot(id: string): Lot {
    assertValidId(id);
    const lot = this.lots.get(id);
    if (!lot) throw new UnknownIdError(`unknown lot id: ${id}`);
    return lot;
  }

  private candidates(now = this.clock.now()): Lot[] {
    const ripe: Lot[] = [];
    for (const lot of this.lots.values()) {
      if (!lot.gated && lot.mashAt < now && now <= lot.runoffAt) {
        ripe.push(lot);
      }
    }
    ripe.sort(
      (a, b) => a.mashAt - b.mashAt || b.gravity - a.gravity || a.seq - b.seq,
    );
    return ripe;
  }
}

function snapshotOf(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    mashAt: lot.mashAt,
    runoffAt: lot.runoffAt,
    gravity: lot.gravity,
  };
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(mashAt: number, runoffAt: number): void {
  if (
    !Number.isInteger(mashAt) ||
    !Number.isInteger(runoffAt) ||
    mashAt < 0 ||
    runoffAt < 0 ||
    runoffAt <= mashAt
  ) {
    throw new InvalidSpanError(
      "mashAt/runoffAt must be integers >= 0 with runoffAt > mashAt",
    );
  }
}

function assertValidGravity(gravity: number): void {
  if (!Number.isInteger(gravity) || gravity < 1) {
    throw new InvalidGravityError("gravity must be an integer >= 1");
  }
}
