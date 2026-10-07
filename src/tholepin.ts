import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidStrokesError,
  UnknownIdError,
} from "./errors.js";
import { StrokeLedger } from "./ledger.js";
import { PinGate } from "./pins.js";
import { SeatRegistry, snapshotOf, type OarSeat, type SeatSnapshot } from "./registry.js";

export interface TholePinOptions {
  clock: VirtualClock;
  maxOars?: number;
  initialCredit?: number;
}

export interface DriveResult {
  stroked: SeatSnapshot[];
  spent: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(readyAt: unknown, shipAt: unknown): void {
  const ok =
    Number.isInteger(readyAt) &&
    Number.isInteger(shipAt) &&
    (readyAt as number) >= 0 &&
    (shipAt as number) >= 0 &&
    (shipAt as number) > (readyAt as number);
  if (!ok) {
    throw new InvalidSpanError("span must be finite integers with 0 <= readyAt < shipAt");
  }
}

function assertValidStrokes(strokes: unknown): void {
  if (!Number.isInteger(strokes) || (strokes as number) < 1) {
    throw new InvalidStrokesError("strokes must be an integer >= 1");
  }
}

export class TholePin {
  private readonly clock: VirtualClock;
  private readonly maxOars: number;
  private readonly ledger: StrokeLedger;
  private readonly gate = new PinGate();
  private readonly registry = new SeatRegistry();

  constructor(options: TholePinOptions) {
    const maxOars = options.maxOars ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxOars) || maxOars < 1) {
      throw new InvalidConfigError("maxOars must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxOars = maxOars;
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
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.readyAt = readyAt;
      existing.shipAt = shipAt;
      existing.strokes = strokes;
      this.gate.pin(id);
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxOars) {
      throw new CapacityError("oar capacity reached");
    }
    this.registry.admit(id, payload, readyAt, shipAt, strokes);
    this.gate.pin(id);
    return { status: "accepted" };
  }

  reship(id: string, readyAt: number, shipAt: number): boolean {
    assertValidId(id);
    assertValidSpan(readyAt, shipAt);
    const seat = this.registry.get(id);
    if (!seat) {
      return false;
    }
    seat.readyAt = readyAt;
    seat.shipAt = shipAt;
    this.gate.unpin(id);
    return true;
  }

  scrap(id: string): boolean {
    assertValidId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gate.forget(id);
    return true;
  }

  pin(id: string): boolean {
    this.requireSeat(id);
    this.gate.pin(id);
    return true;
  }

  unpin(id: string): boolean {
    this.requireSeat(id);
    this.gate.unpin(id);
    return true;
  }

  isPinned(id: string): boolean {
    this.requireSeat(id);
    return this.gate.isPinned(id);
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): SeatSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  stroke(): SeatSnapshot | null {
    const target = this.candidates(this.clock.now()).find((seat) =>
      this.ledger.canAfford(seat.strokes),
    );
    if (!target) {
      return null;
    }
    this.ledger.spend(target.strokes);
    target.strokes -= 1;
    const snap = snapshotOf(target);
    if (target.strokes === 0) {
      this.registry.remove(target.id);
      this.gate.forget(target.id);
    }
    return snap;
  }

  liveIds(): string[] {
    return this.candidates(this.clock.now()).map((seat) => seat.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const stroked: SeatSnapshot[] = [];
    for (;;) {
      const snap = this.stroke();
      if (!snap) {
        break;
      }
      stroked.push(snap);
    }
    const spent: string[] = [];
    for (const seat of this.registry.all()) {
      if (now > seat.shipAt && !this.gate.isPinned(seat.id)) {
        this.registry.remove(seat.id);
        this.gate.forget(seat.id);
        spent.push(seat.id);
      }
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
    const seat = this.registry.get(id);
    return seat ? { readyAt: seat.readyAt, shipAt: seat.shipAt } : null;
  }

  strokesOf(id: string): number | null {
    assertValidId(id);
    const seat = this.registry.get(id);
    return seat ? seat.strokes : null;
  }

  private requireSeat(id: string): void {
    assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private candidates(now: number): OarSeat[] {
    return this.registry
      .all()
      .filter(
        (seat) =>
          !this.gate.isPinned(seat.id) &&
          seat.strokes >= 1 &&
          seat.readyAt <= now &&
          now <= seat.shipAt,
      )
      .sort(
        (a, b) =>
          a.shipAt - b.shipAt || b.strokes - a.strokes || a.seq - b.seq,
      );
  }
}
