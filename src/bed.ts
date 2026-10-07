import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidWindError,
  UnknownIdError,
} from "./errors.js";
import { Gate } from "./gate.js";
import { Ledger } from "./ledger.js";
import { Nozzle, NozzleSnapshot, Registry, snapshotOf } from "./registry.js";

export interface TuyereBedOptions {
  clock: VirtualClock;
  maxNozzles?: number;
  initialWind?: number;
}

function isNonNegativeInt(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

export class TuyereBed {
  private readonly clock: VirtualClock;
  private readonly maxNozzles: number;
  private readonly registry = new Registry();
  private readonly gate = new Gate();
  private readonly ledger: Ledger;

  constructor(options: TuyereBedOptions) {
    const maxNozzles = options.maxNozzles ?? 5;
    const initialWind = options.initialWind ?? 0;
    if (!Number.isInteger(maxNozzles) || maxNozzles < 1) {
      throw new InvalidConfigError("maxNozzles must be an integer >= 1");
    }
    if (!isNonNegativeInt(initialWind)) {
      throw new InvalidConfigError("initialWind must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxNozzles = maxNozzles;
    this.ledger = new Ledger(initialWind);
  }

  private requireValidId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private requireValidSpan(igniteAt: number, snuffAt: number): void {
    if (
      !isNonNegativeInt(igniteAt) ||
      !isNonNegativeInt(snuffAt) ||
      snuffAt <= igniteAt
    ) {
      throw new InvalidSpanError(
        "igniteAt/snuffAt must be integers >= 0 with snuffAt > igniteAt",
      );
    }
  }

  private requireKnown(id: string): Nozzle {
    const nozzle = this.registry.get(id);
    if (nozzle === undefined) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return nozzle;
  }

  /** Live window: strictly past igniteAt, up to and including snuffAt. */
  private isLive(nozzle: Nozzle, now: number): boolean {
    return now > nozzle.igniteAt && now <= nozzle.snuffAt;
  }

  private isExpired(nozzle: Nozzle, now: number): boolean {
    return now > nozzle.snuffAt;
  }

  /** Rank: earlier snuffAt, then higher wind, then first-mount seq. */
  private compareRank(a: Nozzle, b: Nozzle): number {
    if (a.snuffAt !== b.snuffAt) return a.snuffAt - b.snuffAt;
    if (a.wind !== b.wind) return b.wind - a.wind;
    return a.seq - b.seq;
  }

  private candidates(now: number): Nozzle[] {
    return this.registry
      .all()
      .filter((nozzle) => !this.gate.isPinned(nozzle.id) && this.isLive(nozzle, now))
      .sort((a, b) => this.compareRank(a, b));
  }

  mount(
    id: string,
    payload: unknown,
    igniteAt: number,
    snuffAt: number,
    wind = 1,
  ): { status: "accepted" | "updated" } {
    this.requireValidId(id);
    this.requireValidSpan(igniteAt, snuffAt);
    if (!Number.isInteger(wind) || wind < 1) {
      throw new InvalidWindError("wind must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.igniteAt = igniteAt;
      existing.snuffAt = snuffAt;
      existing.wind = wind;
      this.gate.pin(id);
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxNozzles) {
      throw new CapacityError("nozzle capacity reached");
    }
    this.registry.add(id, payload, igniteAt, snuffAt, wind);
    this.gate.pin(id);
    return { status: "accepted" };
  }

  retime(id: string, igniteAt: number, snuffAt: number): boolean {
    this.requireValidId(id);
    this.requireValidSpan(igniteAt, snuffAt);
    const nozzle = this.registry.get(id);
    if (nozzle === undefined) {
      return false;
    }
    nozzle.igniteAt = igniteAt;
    nozzle.snuffAt = snuffAt;
    this.gate.unpin(id);
    return true;
  }

  eject(id: string): boolean {
    this.requireValidId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gate.clear(id);
    return true;
  }

  pin(id: string): boolean {
    this.requireValidId(id);
    this.requireKnown(id);
    this.gate.pin(id);
    return true;
  }

  unpin(id: string): boolean {
    this.requireValidId(id);
    this.requireKnown(id);
    this.gate.unpin(id);
    return true;
  }

  isPinned(id: string): boolean {
    this.requireValidId(id);
    this.requireKnown(id);
    return this.gate.isPinned(id);
  }

  endow(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.ledger.endow(amount);
  }

  wind(): number {
    return this.ledger.available;
  }

  glance(): NozzleSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head === undefined ? null : snapshotOf(head);
  }

  pull(): NozzleSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    if (head === undefined || !this.ledger.canAfford(head.wind)) {
      return null;
    }
    this.ledger.spend(head.wind);
    this.registry.remove(head.id);
    this.gate.clear(head.id);
    return snapshotOf(head);
  }

  liveIds(): string[] {
    return this.candidates(this.clock.now()).map((nozzle) => nozzle.id);
  }

  blast(): { drawn: NozzleSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const drawn: NozzleSnapshot[] = [];
    for (const nozzle of this.candidates(now)) {
      if (!this.ledger.canAfford(nozzle.wind)) {
        break;
      }
      this.ledger.spend(nozzle.wind);
      this.registry.remove(nozzle.id);
      this.gate.clear(nozzle.id);
      drawn.push(snapshotOf(nozzle));
    }
    const spent: string[] = [];
    for (const nozzle of this.registry.all()) {
      if (!this.gate.isPinned(nozzle.id) && this.isExpired(nozzle, now)) {
        this.registry.remove(nozzle.id);
        this.gate.clear(nozzle.id);
        spent.push(nozzle.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { igniteAt: number; snuffAt: number } | null {
    this.requireValidId(id);
    const nozzle = this.registry.get(id);
    if (nozzle === undefined) {
      return null;
    }
    return { igniteAt: nozzle.igniteAt, snuffAt: nozzle.snuffAt };
  }

  windOf(id: string): number | null {
    this.requireValidId(id);
    const nozzle = this.registry.get(id);
    return nozzle === undefined ? null : nozzle.wind;
  }
}
