import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { StrokeLedger } from "./ledger.js";
import {
  Oar,
  Registry,
  assertValidId,
  assertValidSpan,
  assertValidStrokes,
} from "./registry.js";

export interface TholePinOptions {
  clock: VirtualClock;
  maxOars?: number;
  initialCredit?: number;
}

export interface OarSnapshot {
  id: string;
  payload: unknown;
  readyAt: number;
  shipAt: number;
  strokes: number;
}

export interface DriveResult {
  stroked: OarSnapshot[];
  spent: string[];
}

function snapshot(oar: Oar): OarSnapshot {
  return {
    id: oar.id,
    payload: oar.payload,
    readyAt: oar.readyAt,
    shipAt: oar.shipAt,
    strokes: oar.strokes,
  };
}

export class TholePin {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly ledger: StrokeLedger;

  constructor(options: TholePinOptions) {
    const maxOars = options.maxOars ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxOars) || maxOars < 1) {
      throw new InvalidConfigError(`invalid maxOars: ${maxOars}`);
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError(`invalid initialCredit: ${initialCredit}`);
    }
    this.clock = options.clock;
    this.registry = new Registry(maxOars);
    this.ledger = new StrokeLedger(initialCredit);
  }

  seat(
    id: string,
    payload: unknown,
    readyAt: number,
    shipAt: number,
    strokes = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(readyAt, shipAt);
    assertValidStrokes(strokes);
    const status = this.registry.seat(id, payload, readyAt, shipAt, strokes);
    return { status };
  }

  reship(id: string, readyAt: number, shipAt: number): boolean {
    assertValidId(id);
    assertValidSpan(readyAt, shipAt);
    const oar = this.registry.get(id);
    if (!oar) {
      return false;
    }
    oar.readyAt = readyAt;
    oar.shipAt = shipAt;
    oar.pinned = false;
    return true;
  }

  scrap(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  pin(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).pinned = true;
    return true;
  }

  unpin(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).pinned = false;
    return true;
  }

  isPinned(id: string): boolean {
    assertValidId(id);
    return this.registry.require(id).pinned;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): OarSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshot(head) : null;
  }

  stroke(): OarSnapshot | null {
    const target = this.candidates().find((oar) =>
      this.ledger.canAfford(oar.strokes),
    );
    if (!target) {
      return null;
    }
    return this.performStroke(target);
  }

  liveIds(): string[] {
    return this.candidates().map((oar) => oar.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const stroked: OarSnapshot[] = [];
    for (;;) {
      const target = this.candidates(now).find((oar) =>
        this.ledger.canAfford(oar.strokes),
      );
      if (!target) {
        break;
      }
      stroked.push(this.performStroke(target));
    }
    const spent: string[] = [];
    for (const oar of this.registry.all()) {
      if (!oar.pinned && now > oar.shipAt) {
        spent.push(oar.id);
      }
    }
    for (const id of spent) {
      this.registry.remove(id);
    }
    return { stroked, spent };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { readyAt: number; shipAt: number } | null {
    assertValidId(id);
    const oar = this.registry.get(id);
    return oar ? { readyAt: oar.readyAt, shipAt: oar.shipAt } : null;
  }

  strokesOf(id: string): number | null {
    assertValidId(id);
    return this.registry.get(id)?.strokes ?? null;
  }

  private candidates(now = this.clock.now()): Oar[] {
    return this.registry
      .all()
      .filter(
        (oar) =>
          !oar.pinned &&
          oar.strokes >= 1 &&
          oar.readyAt <= now &&
          now <= oar.shipAt,
      )
      .sort(
        (a, b) =>
          a.shipAt - b.shipAt || b.strokes - a.strokes || a.seq - b.seq,
      );
  }

  private performStroke(oar: Oar): OarSnapshot {
    this.ledger.spend(oar.strokes);
    oar.strokes -= 1;
    const result = snapshot(oar);
    if (oar.strokes === 0) {
      this.registry.remove(oar.id);
    }
    return result;
  }
}
