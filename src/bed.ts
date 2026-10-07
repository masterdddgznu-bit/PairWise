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
import { PinGate } from "./gate.js";
import { WindLedger } from "./ledger.js";
import {
  Nozzle,
  NozzleSnapshot,
  Registry,
  snapshotOf,
} from "./registry.js";

export interface TuyereBedOptions {
  clock: VirtualClock;
  maxNozzles?: number;
  initialWind?: number;
}

const DEFAULT_MAX_NOZZLES = 5;
const DEFAULT_INITIAL_WIND = 0;
const DEFAULT_WIND = 1;

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(igniteAt: unknown, snuffAt: unknown): void {
  if (
    typeof igniteAt !== "number" ||
    typeof snuffAt !== "number" ||
    !Number.isInteger(igniteAt) ||
    !Number.isInteger(snuffAt) ||
    igniteAt < 0 ||
    snuffAt < 0 ||
    snuffAt <= igniteAt
  ) {
    throw new InvalidSpanError(
      "igniteAt/snuffAt must be integers >= 0 with snuffAt > igniteAt",
    );
  }
}

function assertValidWind(wind: unknown): void {
  if (typeof wind !== "number" || !Number.isInteger(wind) || wind < 1) {
    throw new InvalidWindError("wind must be an integer >= 1");
  }
}

export class TuyereBed {
  readonly #clock: VirtualClock;
  readonly #maxNozzles: number;
  readonly #registry = new Registry();
  readonly #gate = new PinGate();
  readonly #ledger: WindLedger;

  constructor(options: TuyereBedOptions) {
    const maxNozzles = options.maxNozzles ?? DEFAULT_MAX_NOZZLES;
    const initialWind = options.initialWind ?? DEFAULT_INITIAL_WIND;
    if (!Number.isInteger(maxNozzles) || maxNozzles < 1) {
      throw new InvalidConfigError("maxNozzles must be an integer >= 1");
    }
    if (!Number.isInteger(initialWind) || initialWind < 0) {
      throw new InvalidConfigError("initialWind must be an integer >= 0");
    }
    this.#clock = options.clock;
    this.#maxNozzles = maxNozzles;
    this.#ledger = new WindLedger(initialWind);
  }

  mount(
    id: string,
    payload: unknown,
    igniteAt: number,
    snuffAt: number,
    wind: number = DEFAULT_WIND,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(igniteAt, snuffAt);
    assertValidWind(wind);
    const existing = this.#registry.get(id);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.igniteAt = igniteAt;
      existing.snuffAt = snuffAt;
      existing.wind = wind;
      this.#gate.pin(id);
      return { status: "updated" };
    }
    if (this.#registry.size >= this.#maxNozzles) {
      throw new CapacityError("nozzle capacity reached");
    }
    this.#registry.add({ id, payload, igniteAt, snuffAt, wind });
    this.#gate.pin(id);
    return { status: "accepted" };
  }

  retime(id: string, igniteAt: number, snuffAt: number): boolean {
    assertValidId(id);
    assertValidSpan(igniteAt, snuffAt);
    const nozzle = this.#registry.get(id);
    if (nozzle === undefined) {
      return false;
    }
    nozzle.igniteAt = igniteAt;
    nozzle.snuffAt = snuffAt;
    this.#gate.unpin(id);
    return true;
  }

  eject(id: string): boolean {
    assertValidId(id);
    if (!this.#registry.remove(id)) {
      return false;
    }
    this.#gate.clear(id);
    return true;
  }

  pin(id: string): boolean {
    this.#requireKnown(id);
    this.#gate.pin(id);
    return true;
  }

  unpin(id: string): boolean {
    this.#requireKnown(id);
    this.#gate.unpin(id);
    return true;
  }

  isPinned(id: string): boolean {
    this.#requireKnown(id);
    return this.#gate.isPinned(id);
  }

  endow(amount: number): number {
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < 1
    ) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.#ledger.endow(amount);
  }

  wind(): number {
    return this.#ledger.balance();
  }

  glance(): NozzleSnapshot | null {
    const head = this.#candidates(this.#clock.now())[0];
    return head === undefined ? null : snapshotOf(head);
  }

  pull(): NozzleSnapshot | null {
    const head = this.#candidates(this.#clock.now())[0];
    if (head === undefined || !this.#ledger.canAfford(head.wind)) {
      return null;
    }
    this.#ledger.spend(head.wind);
    this.#remove(head.id);
    return snapshotOf(head);
  }

  liveIds(): string[] {
    return this.#candidates(this.#clock.now()).map((nozzle) => nozzle.id);
  }

  blast(): { drawn: NozzleSnapshot[]; spent: string[] } {
    const now = this.#clock.now();
    const drawn: NozzleSnapshot[] = [];
    for (;;) {
      const head = this.#candidates(now)[0];
      if (head === undefined || !this.#ledger.canAfford(head.wind)) {
        break;
      }
      this.#ledger.spend(head.wind);
      this.#remove(head.id);
      drawn.push(snapshotOf(head));
    }
    const spent: string[] = [];
    for (const nozzle of this.#registry.entries()) {
      if (now > nozzle.snuffAt && !this.#gate.isPinned(nozzle.id)) {
        this.#remove(nozzle.id);
        spent.push(nozzle.id);
      }
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.#registry.ids();
  }

  size(): number {
    return this.#registry.size;
  }

  spanOf(id: string): { igniteAt: number; snuffAt: number } | null {
    assertValidId(id);
    const nozzle = this.#registry.get(id);
    return nozzle === undefined
      ? null
      : { igniteAt: nozzle.igniteAt, snuffAt: nozzle.snuffAt };
  }

  windOf(id: string): number | null {
    assertValidId(id);
    const nozzle = this.#registry.get(id);
    return nozzle === undefined ? null : nozzle.wind;
  }

  #requireKnown(id: string): void {
    assertValidId(id);
    if (!this.#registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  #remove(id: string): void {
    this.#registry.remove(id);
    this.#gate.clear(id);
  }

  /**
   * Draw candidates at `now`: unpinned and strictly inside the blast
   * window (igniteAt < now <= snuffAt). Ranked by earlier snuffAt, then
   * higher wind, then first-mount order (iteration order is stable).
   */
  #candidates(now: number): Nozzle[] {
    return this.#registry
      .entries()
      .filter(
        (nozzle) =>
          !this.#gate.isPinned(nozzle.id) &&
          nozzle.igniteAt < now &&
          now <= nozzle.snuffAt,
      )
      .sort((a, b) => a.snuffAt - b.snuffAt || b.wind - a.wind);
  }
}
