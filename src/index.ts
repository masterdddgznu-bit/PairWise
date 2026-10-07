import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidGravityError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { GateKeeper } from "./gates.js";
import { GravityLedger } from "./ledger.js";
import { Lot, LotRegistry } from "./registry.js";

export { VirtualClock } from "./clock.js";
export {
  LauterBedError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidGravityError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

export interface LauterBedOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialGravity?: number;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  mashAt: number;
  runoffAt: number;
  gravity: number;
}

export interface DriveResult {
  drawn: LotSnapshot[];
  stale: string[];
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

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(mashAt: unknown, runoffAt: unknown): void {
  if (
    typeof mashAt !== "number" ||
    !Number.isInteger(mashAt) ||
    mashAt < 0 ||
    typeof runoffAt !== "number" ||
    !Number.isInteger(runoffAt) ||
    runoffAt < 0 ||
    runoffAt <= (mashAt as number)
  ) {
    throw new InvalidSpanError(
      "mashAt/runoffAt must be integers >= 0 with runoffAt > mashAt",
    );
  }
}

function assertGravity(gravity: unknown): void {
  if (
    typeof gravity !== "number" ||
    !Number.isInteger(gravity) ||
    gravity < 1
  ) {
    throw new InvalidGravityError("gravity must be an integer >= 1");
  }
}

export class LauterBed {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly registry = new LotRegistry();
  private readonly gates = new GateKeeper();
  private readonly ledger: GravityLedger;

  constructor(options: LauterBedOptions) {
    const { clock, maxLots = 5, initialGravity = 0 } = options ?? {};
    if (
      !(clock instanceof VirtualClock) ||
      !Number.isInteger(maxLots) ||
      maxLots < 1 ||
      !Number.isInteger(initialGravity) ||
      initialGravity < 0
    ) {
      throw new InvalidConfigError(
        "clock required; maxLots must be an integer >= 1; initialGravity an integer >= 0",
      );
    }
    this.clock = clock;
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
    assertId(id);
    assertSpan(mashAt, runoffAt);
    assertGravity(gravity);
    const lot: Lot = { id, payload, mashAt, runoffAt, gravity };
    if (this.registry.has(id)) {
      this.registry.update(lot);
      this.gates.ungate(id);
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxLots) {
      throw new CapacityError("lauter bed is at capacity");
    }
    this.registry.add(lot);
    return { status: "accepted" };
  }

  recock(id: string, mashAt: number, runoffAt: number): boolean {
    assertId(id);
    assertSpan(mashAt, runoffAt);
    const lot = this.registry.get(id);
    if (!lot) {
      return false;
    }
    lot.mashAt = mashAt;
    lot.runoffAt = runoffAt;
    return true;
  }

  dump(id: string): boolean {
    assertId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gates.clear(id);
    return true;
  }

  gate(id: string): boolean {
    assertId(id);
    this.requireKnown(id);
    this.gates.gate(id);
    return true;
  }

  ungate(id: string): boolean {
    assertId(id);
    this.requireKnown(id);
    this.gates.ungate(id);
    return true;
  }

  isGated(id: string): boolean {
    assertId(id);
    this.requireKnown(id);
    return this.gates.isGated(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  gravity(): number {
    return this.ledger.available();
  }

  peek(): LotSnapshot | null {
    const head = this.rankedRipe()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): LotSnapshot | null {
    const head = this.rankedRipe()[0];
    if (!head || !this.ledger.canAfford(head.gravity)) {
      return null;
    }
    this.ledger.spend(head.gravity);
    this.registry.remove(head.id);
    this.gates.clear(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.rankedRipe().map((lot) => lot.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const stale: string[] = [];
    for (const lot of this.registry.entries()) {
      if (now > lot.runoffAt && !this.gates.isGated(lot.id)) {
        stale.push(lot.id);
      }
    }
    for (const id of stale) {
      this.registry.remove(id);
      this.gates.clear(id);
    }
    const drawn: LotSnapshot[] = [];
    for (;;) {
      const next = this.pop();
      if (!next) {
        break;
      }
      drawn.push(next);
    }
    return { drawn, stale };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { mashAt: number; runoffAt: number } | null {
    assertId(id);
    const lot = this.registry.get(id);
    if (!lot) {
      return null;
    }
    return { mashAt: lot.mashAt, runoffAt: lot.runoffAt };
  }

  gravityOf(id: string): number | null {
    assertId(id);
    const lot = this.registry.get(id);
    return lot ? lot.gravity : null;
  }

  private requireKnown(id: string): void {
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private rankedRipe(): Lot[] {
    const now = this.clock.now();
    return this.registry
      .entries()
      .filter(
        (lot) =>
          lot.mashAt < now && now <= lot.runoffAt && !this.gates.isGated(lot.id),
      )
      .sort((a, b) => a.mashAt - b.mashAt || b.gravity - a.gravity);
  }
}
