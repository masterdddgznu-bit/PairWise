
import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidBlowError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface DieSnapshot {
  id: string;
  payload: unknown;
  heatAt: number;
  chillAt: number;
  blow: number;
}

interface Die extends DieSnapshot {
  seq: number;
}

export interface SwageBlockOptions {
  clock: VirtualClock;
  maxDies?: number;
  initialBlows?: number;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export class SwageBlock {
  private readonly clock: VirtualClock;
  private readonly maxDies: number;
  private ledger: number;
  private readonly dies = new Map<string, Die>();
  private readonly clamped = new Set<string>();
  private nextSeq = 0;

  constructor(options: SwageBlockOptions) {
    const maxDies = options.maxDies ?? 5;
    const initialBlows = options.initialBlows ?? 0;
    if (!Number.isInteger(maxDies) || maxDies < 1) {
      throw new InvalidConfigError("maxDies must be an integer >= 1");
    }
    if (!isNonNegInt(initialBlows)) {
      throw new InvalidConfigError("initialBlows must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxDies = maxDies;
    this.ledger = initialBlows;
  }

  private requireValidId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private requireKnownId(id: unknown): string {
    this.requireValidId(id);
    if (!this.dies.has(id)) {
      throw new UnknownIdError(`unknown die id: ${id}`);
    }
    return id;
  }

  private requireValidSpan(heatAt: unknown, chillAt: unknown): void {
    if (
      !isNonNegInt(heatAt) ||
      !isNonNegInt(chillAt) ||
      chillAt <= heatAt
    ) {
      throw new InvalidSpanError(
        "heatAt/chillAt must be integers >= 0 with chillAt > heatAt",
      );
    }
  }

  private requireValidBlow(blow: unknown): asserts blow is number {
    if (typeof blow !== "number" || !Number.isInteger(blow) || blow < 1) {
      throw new InvalidBlowError("blow must be an integer >= 1");
    }
  }

  seat(
    id: string,
    payload: unknown,
    heatAt: number,
    chillAt: number,
    blow = 1,
  ): { status: "accepted" | "updated" } {
    this.requireValidId(id);
    this.requireValidSpan(heatAt, chillAt);
    this.requireValidBlow(blow);
    const existing = this.dies.get(id);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.heatAt = heatAt;
      existing.chillAt = chillAt;
      existing.blow = blow;
      this.clamped.delete(id);
      return { status: "updated" };
    }
    if (this.dies.size >= this.maxDies) {
      throw new CapacityError("die registry is at capacity");
    }
    this.dies.set(id, {
      id,
      payload,
      heatAt,
      chillAt,
      blow,
      seq: this.nextSeq++,
    });
    return { status: "accepted" };
  }

  reshape(id: string, heatAt: number, chillAt: number): boolean {
    this.requireValidId(id);
    this.requireValidSpan(heatAt, chillAt);
    const die = this.dies.get(id);
    if (die === undefined) {
      return false;
    }
    die.heatAt = heatAt;
    die.chillAt = chillAt;
    this.clamped.add(id);
    return true;
  }

  yank(id: string): boolean {
    this.requireValidId(id);
    if (!this.dies.delete(id)) {
      return false;
    }
    this.clamped.delete(id);
    return true;
  }

  clamp(id: string): boolean {
    this.clamped.add(this.requireKnownId(id));
    return true;
  }

  unclamp(id: string): boolean {
    this.clamped.delete(this.requireKnownId(id));
    return true;
  }

  isClamped(id: string): boolean {
    return this.clamped.has(this.requireKnownId(id));
  }

  endow(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    this.ledger += amount;
    return this.ledger;
  }

  blows(): number {
    return this.ledger;
  }

  private isLive(die: Die, now: number): boolean {
    return die.heatAt <= now && now < die.chillAt;
  }

  private rankedCandidates(now: number): Die[] {
    const candidates: Die[] = [];
    for (const die of this.dies.values()) {
      if (!this.clamped.has(die.id) && this.isLive(die, now)) {
        candidates.push(die);
      }
    }
    candidates.sort(
      (a, b) => a.chillAt - b.chillAt || a.blow - b.blow || a.seq - b.seq,
    );
    return candidates;
  }

  private snapshot(die: Die): DieSnapshot {
    return {
      id: die.id,
      payload: die.payload,
      heatAt: die.heatAt,
      chillAt: die.chillAt,
      blow: die.blow,
    };
  }

  peek(): DieSnapshot | null {
    const head = this.rankedCandidates(this.clock.now())[0];
    return head === undefined ? null : this.snapshot(head);
  }

  strike(): DieSnapshot | null {
    const head = this.rankedCandidates(this.clock.now())[0];
    if (head === undefined || this.ledger < head.blow) {
      return null;
    }
    this.ledger -= head.blow;
    this.dies.delete(head.id);
    this.clamped.delete(head.id);
    return this.snapshot(head);
  }

  liveIds(): string[] {
    return this.rankedCandidates(this.clock.now()).map((die) => die.id);
  }

  swage(): { struck: DieSnapshot[]; chilled: string[] } {
    const now = this.clock.now();
    const chilled: string[] = [];
    for (const die of this.dies.values()) {
      if (now >= die.chillAt && !this.clamped.has(die.id)) {
        chilled.push(die.id);
      }
    }
    for (const id of chilled) {
      this.dies.delete(id);
    }
    const struck: DieSnapshot[] = [];
    for (;;) {
      const head = this.rankedCandidates(now)[0];
      if (head === undefined || this.ledger < head.blow) {
        break;
      }
      this.ledger -= head.blow;
      this.dies.delete(head.id);
      this.clamped.delete(head.id);
      struck.push(this.snapshot(head));
    }
    return { struck, chilled };
  }

  ids(): string[] {
    return [...this.dies.keys()];
  }

  size(): number {
    return this.dies.size;
  }

  spanOf(id: string): { heatAt: number; chillAt: number } | null {
    this.requireValidId(id);
    const die = this.dies.get(id);
    return die === undefined
      ? null
      : { heatAt: die.heatAt, chillAt: die.chillAt };
  }

  blowOf(id: string): number | null {
    this.requireValidId(id);
    const die = this.dies.get(id);
    return die === undefined ? null : die.blow;
  }
}
