import { BelayGate } from "./belay.js";
import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidTurnsError,
  UnknownIdError,
} from "./errors.js";
import { Ledger } from "./ledger.js";
import { Registry, snapshotOf, type Line, type LineSnapshot } from "./registry.js";

export { VirtualClock } from "./clock.js";
export {
  CleatBindError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidTurnsError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

export interface CleatBindOptions {
  clock: VirtualClock;
  maxLines?: number;
  initialCredit?: number;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class CleatBind {
  private readonly clock: VirtualClock;
  private readonly maxLines: number;
  private readonly registry = new Registry();
  private readonly gate = new BelayGate();
  private readonly ledger: Ledger;

  constructor(options: CleatBindOptions) {
    const maxLines = options?.maxLines ?? 5;
    const initialCredit = options?.initialCredit ?? 0;
    if (
      !options ||
      !(options.clock instanceof VirtualClock) ||
      !isPositiveInt(maxLines) ||
      !isNonNegativeInt(initialCredit)
    ) {
      throw new InvalidConfigError(
        "clock is required; maxLines must be an integer >= 1; initialCredit an integer >= 0",
      );
    }
    this.clock = options.clock;
    this.maxLines = maxLines;
    this.ledger = new Ledger(initialCredit);
  }

  private requireValidId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private requireKnown(id: unknown): string {
    this.requireValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return id;
  }

  private static validateSpan(hitchAt: unknown, castAt: unknown): void {
    if (
      !isNonNegativeInt(hitchAt) ||
      !isNonNegativeInt(castAt) ||
      castAt <= hitchAt
    ) {
      throw new InvalidSpanError(
        "hitchAt/castAt must be integers >= 0 with castAt > hitchAt",
      );
    }
  }

  hitch(
    id: string,
    payload: unknown,
    hitchAt: number,
    castAt: number,
    turns = 1,
  ): { status: "accepted" | "updated" } {
    this.requireValidId(id);
    CleatBind.validateSpan(hitchAt, castAt);
    if (!isPositiveInt(turns)) {
      throw new InvalidTurnsError("turns must be an integer >= 1");
    }

    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.hitchAt = hitchAt;
      existing.castAt = castAt;
      existing.turns = turns;
      this.gate.belay(id);
      return { status: "updated" };
    }

    if (this.registry.size >= this.maxLines) {
      throw new CapacityError("maxLines reached");
    }
    this.registry.add({ id, payload, hitchAt, castAt, turns });
    this.gate.belay(id);
    return { status: "accepted" };
  }

  retune(id: string, hitchAt: number, castAt: number): boolean {
    CleatBind.validateSpan(hitchAt, castAt);
    const line = this.registry.get(id);
    if (!line) {
      return false;
    }
    line.hitchAt = hitchAt;
    line.castAt = castAt;
    this.gate.free(id);
    return true;
  }

  drop(id: string): boolean {
    this.requireValidId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gate.clear(id);
    return true;
  }

  belay(id: string): boolean {
    this.gate.belay(this.requireKnown(id));
    return true;
  }

  free(id: string): boolean {
    this.gate.free(this.requireKnown(id));
    return true;
  }

  isBelayed(id: string): boolean {
    return this.gate.isBelayed(this.requireKnown(id));
  }

  endow(amount: number): number {
    if (!isPositiveInt(amount)) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  private isLive(line: Line, now: number): boolean {
    return line.hitchAt <= now && now < line.castAt;
  }

  /**
   * Pull candidates: inside the window, unlatched, with turns remaining.
   * Ranked by later castAt, then lower turns, then first-admission order.
   */
  private candidates(): Line[] {
    const now = this.clock.now();
    return this.registry
      .inOrder()
      .filter(
        (line) =>
          !this.gate.isBelayed(line.id) &&
          line.turns >= 1 &&
          this.isLive(line, now),
      )
      .sort(
        (a, b) =>
          b.castAt - a.castAt ||
          a.turns - b.turns ||
          0 /* stable: keeps first-admission order for ties */,
      );
  }

  peek(): LineSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pull(): LineSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.turns)) {
      return null;
    }
    this.ledger.spend(head.turns);
    head.turns -= 1;
    const result = snapshotOf(head);
    if (head.turns === 0) {
      this.registry.remove(head.id);
      this.gate.clear(head.id);
    }
    return result;
  }

  liveIds(): string[] {
    return this.candidates().map((line) => line.id);
  }

  bind(): { pulled: LineSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const pulled: LineSnapshot[] = [];
    for (;;) {
      const next = this.pull();
      if (!next) {
        break;
      }
      pulled.push(next);
    }
    const spent: string[] = [];
    for (const line of this.registry.inOrder()) {
      if (now >= line.castAt && !this.gate.isBelayed(line.id)) {
        this.registry.remove(line.id);
        this.gate.clear(line.id);
        spent.push(line.id);
      }
    }
    return { pulled, spent };
  }

  ids(): string[] {
    return this.registry.inOrder().map((line) => line.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { hitchAt: number; castAt: number } | null {
    this.requireValidId(id);
    const line = this.registry.get(id);
    return line ? { hitchAt: line.hitchAt, castAt: line.castAt } : null;
  }

  turnsOf(id: string): number | null {
    this.requireValidId(id);
    const line = this.registry.get(id);
    return line ? line.turns : null;
  }
}
