import { VirtualClock } from "./clock.js";
import { InvalidConfigError, UnknownIdError } from "./errors.js";
import { GateKeeper } from "./gate.js";
import { AirLedger } from "./ledger.js";
import {
  Mound,
  Registry,
  assertValidCost,
  assertValidId,
  assertValidSpan,
} from "./registry.js";

export interface CharPileOptions {
  clock: VirtualClock;
  maxMounds?: number;
  initialAir?: number;
}

export interface MoundSnapshot {
  id: string;
  payload: unknown;
  bankAt: number;
  drawAt: number;
  cost: number;
}

export interface DriveResult {
  drawn: MoundSnapshot[];
  spoiled: string[];
}

function snapshotOf(mound: Mound): MoundSnapshot {
  return {
    id: mound.id,
    payload: mound.payload,
    bankAt: mound.bankAt,
    drawAt: mound.drawAt,
    cost: mound.cost,
  };
}

export class CharPile {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly gates = new GateKeeper();
  private readonly ledger: AirLedger;

  constructor(options: CharPileOptions) {
    if (
      !options ||
      typeof options !== "object" ||
      !options.clock ||
      typeof options.clock.now !== "function"
    ) {
      throw new InvalidConfigError("a clock with now() is required");
    }
    const maxMounds = options.maxMounds ?? 5;
    const initialAir = options.initialAir ?? 0;
    if (!Number.isInteger(maxMounds) || maxMounds < 1) {
      throw new InvalidConfigError("maxMounds must be an integer >= 1");
    }
    if (!Number.isInteger(initialAir) || initialAir < 0) {
      throw new InvalidConfigError("initialAir must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new Registry(maxMounds);
    this.ledger = new AirLedger(initialAir);
  }

  bank(
    id: string,
    payload: unknown,
    bankAt: number,
    drawAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(bankAt, drawAt);
    assertValidCost(cost);
    const status = this.registry.bank(id, payload, bankAt, drawAt, cost);
    if (status === "accepted") {
      this.gates.vent(id);
    }
    return { status };
  }

  rebank(id: string, bankAt: number, drawAt: number): boolean {
    assertValidId(id);
    assertValidSpan(bankAt, drawAt);
    const mound = this.registry.get(id);
    if (!mound) {
      return false;
    }
    mound.bankAt = bankAt;
    mound.drawAt = drawAt;
    return true;
  }

  yank(id: string): boolean {
    assertValidId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gates.clear(id);
    return true;
  }

  vent(id: string): boolean {
    this.requireKnown(id);
    this.gates.vent(id);
    return true;
  }

  unvent(id: string): boolean {
    this.requireKnown(id);
    this.gates.unvent(id);
    return true;
  }

  isVented(id: string): boolean {
    this.requireKnown(id);
    return this.gates.isVented(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  air(): number {
    return this.ledger.available();
  }

  peek(): MoundSnapshot | null {
    const ranked = this.rankedCandidates(this.clock.now());
    return ranked.length === 0 ? null : snapshotOf(ranked[0]);
  }

  pop(): MoundSnapshot | null {
    const ranked = this.rankedCandidates(this.clock.now());
    const target = ranked.find((mound) => this.ledger.canAfford(mound.cost));
    if (!target) {
      return null;
    }
    this.ledger.spend(target.cost);
    this.registry.remove(target.id);
    this.gates.clear(target.id);
    return snapshotOf(target);
  }

  ripeIds(): string[] {
    return this.rankedCandidates(this.clock.now()).map((mound) => mound.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spoiled: string[] = [];
    for (const mound of this.registry.inFirstBankOrder()) {
      if (now > mound.drawAt && !this.gates.isVented(mound.id)) {
        spoiled.push(mound.id);
      }
    }
    for (const id of spoiled) {
      this.registry.remove(id);
      this.gates.clear(id);
    }
    const drawn: MoundSnapshot[] = [];
    for (;;) {
      const next = this.pop();
      if (!next) {
        break;
      }
      drawn.push(next);
    }
    return { drawn, spoiled };
  }

  ids(): string[] {
    return this.registry.inFirstBankOrder().map((mound) => mound.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { bankAt: number; drawAt: number } | null {
    assertValidId(id);
    const mound = this.registry.get(id);
    return mound ? { bankAt: mound.bankAt, drawAt: mound.drawAt } : null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    const mound = this.registry.get(id);
    return mound ? mound.cost : null;
  }

  private requireKnown(id: string): void {
    assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private rankedCandidates(now: number): Mound[] {
    return this.registry
      .inFirstBankOrder()
      .filter(
        (mound) =>
          !this.gates.isVented(mound.id) &&
          mound.bankAt <= now &&
          now <= mound.drawAt,
      )
      .sort(
        (a, b) => a.bankAt - b.bankAt || b.cost - a.cost || a.seq - b.seq,
      );
  }
}
