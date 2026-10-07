import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidSpanError,
  InvalidTurnsError,
} from "./errors.js";
import { TurnLedger } from "./ledger.js";
import { Line, LineRegistry, assertValidId } from "./registry.js";

export interface FifeRailOptions {
  clock: VirtualClock;
  maxLines?: number;
  initialCredit?: number;
}

export interface LineSnapshot {
  id: string;
  payload: unknown;
  makeAt: number;
  castAt: number;
  turns: number;
}

export interface DriveResult {
  veered: LineSnapshot[];
  spent: string[];
}

function assertValidSpan(makeAt: unknown, castAt: unknown): void {
  if (
    !Number.isInteger(makeAt) ||
    !Number.isInteger(castAt) ||
    (makeAt as number) < 0 ||
    (castAt as number) < 0 ||
    (castAt as number) <= (makeAt as number)
  ) {
    throw new InvalidSpanError("span must be finite integers >= 0 with castAt > makeAt");
  }
}

function snapshotOf(line: Line): LineSnapshot {
  return {
    id: line.id,
    payload: line.payload,
    makeAt: line.makeAt,
    castAt: line.castAt,
    turns: line.turns,
  };
}

export class FifeRail {
  private readonly clock: VirtualClock;
  private readonly maxLines: number;
  private readonly ledger: TurnLedger;
  private readonly registry = new LineRegistry();

  constructor(options: FifeRailOptions) {
    const maxLines = options.maxLines ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxLines) || maxLines < 1) {
      throw new InvalidConfigError("maxLines must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxLines = maxLines;
    this.ledger = new TurnLedger(initialCredit);
  }

  seat(
    id: string,
    payload: unknown,
    makeAt: number,
    castAt: number,
    turns = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(makeAt, castAt);
    if (!Number.isInteger(turns) || turns < 1) {
      throw new InvalidTurnsError("turns must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.makeAt = makeAt;
      existing.castAt = castAt;
      existing.turns = turns;
      existing.belayed = false;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxLines) {
      throw new CapacityError("no free line slots");
    }
    this.registry.add(id, payload, makeAt, castAt, turns);
    return { status: "accepted" };
  }

  retie(id: string, makeAt: number, castAt: number): boolean {
    assertValidId(id);
    assertValidSpan(makeAt, castAt);
    const line = this.registry.get(id);
    if (!line) {
      return false;
    }
    line.makeAt = makeAt;
    line.castAt = castAt;
    line.belayed = true;
    return true;
  }

  scrap(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  belay(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).belayed = true;
    return true;
  }

  unbelay(id: string): boolean {
    assertValidId(id);
    this.registry.require(id).belayed = false;
    return true;
  }

  isBelayed(id: string): boolean {
    assertValidId(id);
    return this.registry.require(id).belayed;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  private isLive(line: Line, now: number): boolean {
    return line.belayed && line.turns >= 1 && line.makeAt <= now && now <= line.castAt;
  }

  private rankedLive(): Line[] {
    const now = this.clock.now();
    return this.registry
      .inFirstAdmitOrder()
      .filter((line) => this.isLive(line, now))
      .sort((a, b) => b.castAt - a.castAt || a.turns - b.turns || a.seq - b.seq);
  }

  peek(): LineSnapshot | null {
    const head = this.rankedLive()[0];
    return head ? snapshotOf(head) : null;
  }

  veer(): LineSnapshot | null {
    const head = this.rankedLive()[0];
    if (!head) {
      return null;
    }
    const cost = head.castAt - head.makeAt;
    if (!this.ledger.canAfford(cost)) {
      return null;
    }
    this.ledger.spend(cost);
    head.turns -= 1;
    const snapshot = snapshotOf(head);
    if (head.turns === 0) {
      this.registry.remove(head.id);
    }
    return snapshot;
  }

  liveIds(): string[] {
    return this.rankedLive().map((line) => line.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const line of this.registry.inFirstAdmitOrder()) {
      if (line.belayed && now > line.castAt) {
        this.registry.remove(line.id);
        spent.push(line.id);
      }
    }
    const veered: LineSnapshot[] = [];
    for (;;) {
      const snapshot = this.veer();
      if (!snapshot) {
        break;
      }
      veered.push(snapshot);
    }
    return { veered, spent };
  }

  ids(): string[] {
    return this.registry.inFirstAdmitOrder().map((line) => line.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { makeAt: number; castAt: number } | null {
    assertValidId(id);
    const line = this.registry.get(id);
    return line ? { makeAt: line.makeAt, castAt: line.castAt } : null;
  }

  turnsOf(id: string): number | null {
    assertValidId(id);
    const line = this.registry.get(id);
    return line ? line.turns : null;
  }
}
