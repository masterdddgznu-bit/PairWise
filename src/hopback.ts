import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidIbuError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { PlugGate } from "./gate.js";
import { IbuLedger } from "./ledger.js";
import { ChargeEntry, ChargeRegistry } from "./registry.js";

export interface HopBackOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialIbu?: number;
}

export interface ChargeView {
  id: string;
  payload: unknown;
  steepAt: number;
  dumpAt: number;
  ibu: number;
}

export interface DriveResult {
  drawn: ChargeView[];
  spent: string[];
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(steepAt: unknown, dumpAt: unknown): void {
  if (
    typeof steepAt !== "number" ||
    typeof dumpAt !== "number" ||
    !Number.isInteger(steepAt) ||
    !Number.isInteger(dumpAt) ||
    steepAt < 0 ||
    dumpAt < 0 ||
    dumpAt <= steepAt
  ) {
    throw new InvalidSpanError("span must be finite integers >= 0 with dumpAt > steepAt");
  }
}

function assertIbu(ibu: unknown): void {
  if (typeof ibu !== "number" || !Number.isInteger(ibu) || ibu < 1) {
    throw new InvalidIbuError("ibu must be a finite integer >= 1");
  }
}

function viewOf(entry: ChargeEntry): ChargeView {
  return {
    id: entry.id,
    payload: entry.payload,
    steepAt: entry.steepAt,
    dumpAt: entry.dumpAt,
    ibu: entry.ibu,
  };
}

function compareEntries(a: ChargeEntry, b: ChargeEntry): number {
  if (a.dumpAt !== b.dumpAt) return a.dumpAt - b.dumpAt;
  if (a.ibu !== b.ibu) return b.ibu - a.ibu;
  return a.seq - b.seq;
}

export class HopBack {
  private readonly clock: VirtualClock;
  private readonly maxCharges: number;
  private readonly registry = new ChargeRegistry();
  private readonly gate = new PlugGate();
  private readonly ledger: IbuLedger;

  constructor(options: HopBackOptions) {
    const maxCharges = options?.maxCharges ?? 5;
    const initialIbu = options?.initialIbu ?? 0;
    if (
      !options ||
      !(options.clock instanceof VirtualClock) ||
      !Number.isInteger(maxCharges) ||
      maxCharges < 1 ||
      !Number.isInteger(initialIbu) ||
      initialIbu < 0
    ) {
      throw new InvalidConfigError("clock required; maxCharges integer >= 1; initialIbu integer >= 0");
    }
    this.clock = options.clock;
    this.maxCharges = maxCharges;
    this.ledger = new IbuLedger(initialIbu);
  }

  charge(
    id: string,
    payload: unknown,
    steepAt: number,
    dumpAt: number,
    ibu = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(steepAt, dumpAt);
    assertIbu(ibu);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.steepAt = steepAt;
      existing.dumpAt = dumpAt;
      existing.ibu = ibu;
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxCharges) {
      throw new CapacityError("maxCharges reached");
    }
    this.registry.add(id, payload, steepAt, dumpAt, ibu);
    this.gate.plug(id);
    return { status: "accepted" };
  }

  retime(id: string, steepAt: number, dumpAt: number): boolean {
    assertId(id);
    assertSpan(steepAt, dumpAt);
    const entry = this.registry.get(id);
    if (!entry) return false;
    entry.steepAt = steepAt;
    entry.dumpAt = dumpAt;
    this.gate.unplug(id);
    return true;
  }

  toss(id: string): boolean {
    assertId(id);
    if (!this.registry.remove(id)) return false;
    this.gate.clear(id);
    return true;
  }

  plug(id: string): boolean {
    assertId(id);
    if (!this.registry.has(id)) throw new UnknownIdError(`unknown id: ${id}`);
    this.gate.plug(id);
    return true;
  }

  unplug(id: string): boolean {
    assertId(id);
    if (!this.registry.has(id)) throw new UnknownIdError(`unknown id: ${id}`);
    this.gate.unplug(id);
    return true;
  }

  isPlugged(id: string): boolean {
    assertId(id);
    if (!this.registry.has(id)) throw new UnknownIdError(`unknown id: ${id}`);
    return this.gate.isPlugged(id);
  }

  grant(amount: number): number {
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  ibu(): number {
    return this.ledger.available();
  }

  private candidates(now: number): ChargeEntry[] {
    return this.registry
      .inOrder()
      .filter(
        (entry) =>
          !this.gate.isPlugged(entry.id) && entry.steepAt <= now && now <= entry.dumpAt,
      )
      .sort(compareEntries);
  }

  peek(): ChargeView | null {
    const candidates = this.candidates(this.clock.now());
    return candidates.length === 0 ? null : viewOf(candidates[0]);
  }

  pop(): ChargeView | null {
    const candidates = this.candidates(this.clock.now());
    const pick = candidates.find((entry) => this.ledger.canAfford(entry.ibu));
    if (!pick) return null;
    this.ledger.spend(pick.ibu);
    this.registry.remove(pick.id);
    this.gate.clear(pick.id);
    return viewOf(pick);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((entry) => entry.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const entry of this.registry.inOrder()) {
      if (entry.dumpAt < now && !this.gate.isPlugged(entry.id)) {
        this.registry.remove(entry.id);
        this.gate.clear(entry.id);
        spent.push(entry.id);
      }
    }
    const drawn: ChargeView[] = [];
    for (;;) {
      const pick = this.candidates(now).find((entry) => this.ledger.canAfford(entry.ibu));
      if (!pick) break;
      this.ledger.spend(pick.ibu);
      this.registry.remove(pick.id);
      this.gate.clear(pick.id);
      drawn.push(viewOf(pick));
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.inOrder().map((entry) => entry.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { steepAt: number; dumpAt: number } | null {
    assertId(id);
    const entry = this.registry.get(id);
    return entry ? { steepAt: entry.steepAt, dumpAt: entry.dumpAt } : null;
  }

  ibuOf(id: string): number | null {
    assertId(id);
    const entry = this.registry.get(id);
    return entry ? entry.ibu : null;
  }
}
