import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidTurnsError,
  UnknownIdError,
} from "./errors.js";
import { TurnLedger } from "./ledger.js";

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

interface Line {
  id: string;
  payload: unknown;
  makeAt: number;
  castAt: number;
  turns: number;
  seq: number;
  belayed: boolean;
}

export class FifeRail {
  private readonly clock: VirtualClock;
  private readonly maxLines: number;
  private readonly ledger: TurnLedger;
  private readonly lines = new Map<string, Line>();
  private nextSeq = 0;

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
    assertId(id);
    assertSpan(makeAt, castAt);
    assertTurns(turns);
    const existing = this.lines.get(id);
    if (existing) {
      existing.payload = payload;
      existing.makeAt = makeAt;
      existing.castAt = castAt;
      existing.turns = turns;
      existing.belayed = false;
      return { status: "updated" };
    }
    if (this.lines.size >= this.maxLines) {
      throw new CapacityError("no free pins on the rail");
    }
    this.lines.set(id, {
      id,
      payload,
      makeAt,
      castAt,
      turns,
      seq: this.nextSeq++,
      belayed: false,
    });
    return { status: "accepted" };
  }

  retie(id: string, makeAt: number, castAt: number): boolean {
    assertId(id);
    assertSpan(makeAt, castAt);
    const line = this.lines.get(id);
    if (!line) {
      return false;
    }
    line.makeAt = makeAt;
    line.castAt = castAt;
    line.belayed = true;
    return true;
  }

  scrap(id: string): boolean {
    assertId(id);
    return this.lines.delete(id);
  }

  belay(id: string): boolean {
    const line = this.requireLine(id);
    line.belayed = true;
    return true;
  }

  unbelay(id: string): boolean {
    const line = this.requireLine(id);
    line.belayed = false;
    return true;
  }

  isBelayed(id: string): boolean {
    return this.requireLine(id).belayed;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): LineSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  veer(): LineSnapshot | null {
    const head = this.candidates()[0];
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
      this.lines.delete(head.id);
    }
    return snapshot;
  }

  liveIds(): string[] {
    return this.candidates().map((line) => line.id);
  }

  drive(): { veered: LineSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const line of this.lines.values()) {
      if (line.belayed && now > line.castAt) {
        spent.push(line.id);
      }
    }
    for (const id of spent) {
      this.lines.delete(id);
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
    return [...this.lines.keys()];
  }

  size(): number {
    return this.lines.size;
  }

  spanOf(id: string): { makeAt: number; castAt: number } | null {
    assertId(id);
    const line = this.lines.get(id);
    return line ? { makeAt: line.makeAt, castAt: line.castAt } : null;
  }

  turnsOf(id: string): number | null {
    assertId(id);
    const line = this.lines.get(id);
    return line ? line.turns : null;
  }

  private requireLine(id: string): Line {
    assertId(id);
    const line = this.lines.get(id);
    if (!line) {
      throw new UnknownIdError(`unknown line id: ${id}`);
    }
    return line;
  }

  private candidates(): Line[] {
    const now = this.clock.now();
    const live: Line[] = [];
    for (const line of this.lines.values()) {
      if (
        line.belayed &&
        line.turns >= 1 &&
        now >= line.makeAt &&
        now <= line.castAt
      ) {
        live.push(line);
      }
    }
    live.sort(
      (a, b) =>
        b.castAt - a.castAt || a.turns - b.turns || a.seq - b.seq,
    );
    return live;
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

function assertId(id: string): void {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(makeAt: number, castAt: number): void {
  if (
    !Number.isInteger(makeAt) ||
    !Number.isInteger(castAt) ||
    makeAt < 0 ||
    castAt < 0 ||
    castAt <= makeAt
  ) {
    throw new InvalidSpanError(
      "makeAt/castAt must be integers >= 0 with castAt > makeAt",
    );
  }
}

function assertTurns(turns: number): void {
  if (!Number.isInteger(turns) || turns < 1) {
    throw new InvalidTurnsError("turns must be an integer >= 1");
  }
}
