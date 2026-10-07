import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidPigmentError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { PigmentLedger } from "./ledger.js";

export interface Lot {
  id: string;
  payload: unknown;
  soakAt: number;
  rinseAt: number;
  pigment: number;
}

interface Entry extends Lot {
  seq: number;
  bound: boolean;
}

export interface WoadVatOptions {
  clock: VirtualClock;
  maxLots?: number;
  initialPigment?: number;
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isValidSpan(soakAt: unknown, rinseAt: unknown): boolean {
  return (
    typeof soakAt === "number" &&
    Number.isInteger(soakAt) &&
    soakAt >= 0 &&
    typeof rinseAt === "number" &&
    Number.isInteger(rinseAt) &&
    rinseAt >= 0 &&
    rinseAt > soakAt
  );
}

function isValidPigment(pigment: unknown): boolean {
  return (
    typeof pigment === "number" && Number.isInteger(pigment) && pigment >= 1
  );
}

export class WoadVat {
  private readonly clock: VirtualClock;
  private readonly maxLots: number;
  private readonly ledger: PigmentLedger;
  private readonly entries = new Map<string, Entry>();
  private nextSeq = 0;

  constructor(options: WoadVatOptions) {
    const maxLots = options.maxLots ?? 5;
    const initialPigment = options.initialPigment ?? 0;
    if (!Number.isInteger(maxLots) || maxLots < 1) {
      throw new InvalidConfigError("maxLots must be an integer >= 1");
    }
    if (!Number.isInteger(initialPigment) || initialPigment < 0) {
      throw new InvalidConfigError("initialPigment must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxLots = maxLots;
    this.ledger = new PigmentLedger(initialPigment);
  }

  private requireId(id: unknown): asserts id is string {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private requireSpan(soakAt: unknown, rinseAt: unknown): void {
    if (!isValidSpan(soakAt, rinseAt)) {
      throw new InvalidSpanError(
        "soakAt/rinseAt must be integers >= 0 with rinseAt > soakAt",
      );
    }
  }

  private requirePigment(pigment: unknown): void {
    if (!isValidPigment(pigment)) {
      throw new InvalidPigmentError("pigment must be an integer >= 1");
    }
  }

  private lookup(id: unknown): Entry {
    this.requireId(id);
    const entry = this.entries.get(id);
    if (!entry) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return entry;
  }

  store(
    id: string,
    payload: unknown,
    soakAt: number,
    rinseAt: number,
    pigment = 1,
  ): { status: "accepted" | "updated" } {
    this.requireId(id);
    this.requireSpan(soakAt, rinseAt);
    this.requirePigment(pigment);
    const existing = this.entries.get(id);
    if (existing) {
      existing.payload = payload;
      existing.soakAt = soakAt;
      existing.rinseAt = rinseAt;
      existing.pigment = pigment;
      return { status: "updated" };
    }
    if (this.entries.size >= this.maxLots) {
      throw new CapacityError("vat is at capacity");
    }
    this.entries.set(id, {
      id,
      payload,
      soakAt,
      rinseAt,
      pigment,
      seq: this.nextSeq++,
      bound: true,
    });
    return { status: "accepted" };
  }

  retune(id: string, soakAt: number, rinseAt: number): boolean {
    this.requireId(id);
    this.requireSpan(soakAt, rinseAt);
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }
    entry.soakAt = soakAt;
    entry.rinseAt = rinseAt;
    entry.bound = true;
    return true;
  }

  drop(id: string): boolean {
    this.requireId(id);
    return this.entries.delete(id);
  }

  bind(id: string): boolean {
    this.lookup(id).bound = true;
    return true;
  }

  unbind(id: string): boolean {
    this.lookup(id).bound = false;
    return true;
  }

  isBound(id: string): boolean {
    return this.lookup(id).bound;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  pigment(): number {
    return this.ledger.available();
  }

  private inWindow(entry: Entry, now: number): boolean {
    return entry.soakAt <= now && now < entry.rinseAt;
  }

  private isSpent(entry: Entry, now: number): boolean {
    return now >= entry.rinseAt;
  }

  private candidates(now: number): Entry[] {
    const ripe: Entry[] = [];
    for (const entry of this.entries.values()) {
      if (!entry.bound && this.inWindow(entry, now)) {
        ripe.push(entry);
      }
    }
    ripe.sort((a, b) => {
      if (a.soakAt !== b.soakAt) return a.soakAt - b.soakAt;
      if (a.pigment !== b.pigment) return b.pigment - a.pigment;
      return a.seq - b.seq;
    });
    return ripe;
  }

  private static toLot(entry: Entry): Lot {
    return {
      id: entry.id,
      payload: entry.payload,
      soakAt: entry.soakAt,
      rinseAt: entry.rinseAt,
      pigment: entry.pigment,
    };
  }

  peek(): Lot | null {
    const ripe = this.candidates(this.clock.now());
    return ripe.length > 0 ? WoadVat.toLot(ripe[0]) : null;
  }

  pop(): Lot | null {
    const now = this.clock.now();
    for (const entry of this.candidates(now)) {
      if (this.ledger.canAfford(entry.pigment)) {
        this.ledger.spend(entry.pigment);
        this.entries.delete(entry.id);
        return WoadVat.toLot(entry);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((entry) => entry.id);
  }

  drive(): { drawn: Lot[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const entry of [...this.entries.values()]) {
      if (!entry.bound && this.isSpent(entry, now)) {
        this.entries.delete(entry.id);
        spent.push(entry.id);
      }
    }
    const drawn: Lot[] = [];
    for (;;) {
      let picked: Entry | null = null;
      for (const entry of this.candidates(now)) {
        if (this.ledger.canAfford(entry.pigment)) {
          picked = entry;
          break;
        }
      }
      if (!picked) break;
      this.ledger.spend(picked.pigment);
      this.entries.delete(picked.id);
      drawn.push(WoadVat.toLot(picked));
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return [...this.entries.values()].map((entry) => entry.id);
  }

  size(): number {
    return this.entries.size;
  }

  spanOf(id: string): { soakAt: number; rinseAt: number } | null {
    this.requireId(id);
    const entry = this.entries.get(id);
    return entry ? { soakAt: entry.soakAt, rinseAt: entry.rinseAt } : null;
  }

  pigmentOf(id: string): number | null {
    this.requireId(id);
    const entry = this.entries.get(id);
    return entry ? entry.pigment : null;
  }
}
