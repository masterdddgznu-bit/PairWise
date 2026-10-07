import {
  CapacityError,
  InvalidConfigError,
  InvalidFluxError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import type { VirtualClock } from "./clock.js";
import { FluxLedger } from "./flux-ledger.js";
import {
  ChargeRegistry,
  compareCharges,
  snapshotOf,
  type Charge,
  type ChargeSnapshot,
} from "./registry.js";

export interface SlagQuenchOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialFlux?: number;
}

export interface DriveResult {
  drawn: ChargeSnapshot[];
  spent: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(dunkAt: number, liftAt: number): void {
  if (
    !Number.isInteger(dunkAt) ||
    !Number.isInteger(liftAt) ||
    dunkAt < 0 ||
    liftAt < 0 ||
    liftAt <= dunkAt
  ) {
    throw new InvalidSpanError("span requires finite integers 0 <= dunkAt < liftAt");
  }
}

function assertValidFlux(flux: number): void {
  if (!Number.isInteger(flux) || flux < 1) {
    throw new InvalidFluxError("flux must be an integer >= 1");
  }
}

export class SlagQuench {
  #clock: VirtualClock;
  #maxCharges: number;
  #ledger: FluxLedger;
  #registry = new ChargeRegistry();

  constructor(options: SlagQuenchOptions) {
    const maxCharges = options?.maxCharges ?? 5;
    const initialFlux = options?.initialFlux ?? 0;
    if (
      typeof options?.clock?.now !== "function" ||
      !Number.isInteger(maxCharges) ||
      maxCharges < 1 ||
      !Number.isInteger(initialFlux) ||
      initialFlux < 0
    ) {
      throw new InvalidConfigError(
        "config requires a clock, integer maxCharges >= 1, integer initialFlux >= 0",
      );
    }
    this.#clock = options.clock;
    this.#maxCharges = maxCharges;
    this.#ledger = new FluxLedger(initialFlux);
  }

  store(
    id: string,
    payload: unknown,
    dunkAt: number,
    liftAt: number,
    flux = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(dunkAt, liftAt);
    assertValidFlux(flux);
    const existing = this.#registry.get(id);
    if (existing) {
      this.#registry.overwrite(existing, payload, dunkAt, liftAt, flux);
      return { status: "updated" };
    }
    if (this.#registry.size() >= this.#maxCharges) {
      throw new CapacityError("registry is at maxCharges");
    }
    this.#registry.add(id, payload, dunkAt, liftAt, flux);
    return { status: "accepted" };
  }

  retune(id: string, dunkAt: number, liftAt: number): boolean {
    assertValidId(id);
    assertValidSpan(dunkAt, liftAt);
    const charge = this.#registry.get(id);
    if (!charge) {
      return false;
    }
    charge.dunkAt = dunkAt;
    charge.liftAt = liftAt;
    charge.clamped = false;
    return true;
  }

  drop(id: string): boolean {
    assertValidId(id);
    return this.#registry.remove(id);
  }

  clamp(id: string): boolean {
    return this.#setClamped(id, true);
  }

  unclamp(id: string): boolean {
    return this.#setClamped(id, false);
  }

  isClamped(id: string): boolean {
    return this.#requireCharge(id).clamped;
  }

  grant(amount: number): number {
    return this.#ledger.grant(amount);
  }

  flux(): number {
    return this.#ledger.balance();
  }

  peek(): ChargeSnapshot | null {
    const head = this.#candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): ChargeSnapshot | null {
    const head = this.#candidates()[0];
    if (!head || !this.#ledger.trySpend(head.flux)) {
      return null;
    }
    this.#registry.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.#candidates().map((charge) => charge.id);
  }

  drive(): DriveResult {
    const now = this.#clock.now();
    const spent: string[] = [];
    for (const charge of this.#registry.values()) {
      if (!charge.clamped && now >= charge.liftAt) {
        this.#registry.remove(charge.id);
        spent.push(charge.id);
      }
    }
    const drawn: ChargeSnapshot[] = [];
    for (;;) {
      const head = this.#candidates(now)[0];
      if (!head || !this.#ledger.trySpend(head.flux)) {
        break;
      }
      this.#registry.remove(head.id);
      drawn.push(snapshotOf(head));
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.#registry.ids();
  }

  size(): number {
    return this.#registry.size();
  }

  spanOf(id: string): { dunkAt: number; liftAt: number } | null {
    assertValidId(id);
    const charge = this.#registry.get(id);
    return charge ? { dunkAt: charge.dunkAt, liftAt: charge.liftAt } : null;
  }

  fluxOf(id: string): number | null {
    assertValidId(id);
    const charge = this.#registry.get(id);
    return charge ? charge.flux : null;
  }

  #setClamped(id: string, clamped: boolean): boolean {
    this.#requireCharge(id).clamped = clamped;
    return true;
  }

  #requireCharge(id: string): Charge {
    assertValidId(id);
    const charge = this.#registry.get(id);
    if (!charge) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return charge;
  }

  #candidates(now = this.#clock.now()): Charge[] {
    return this.#registry
      .values()
      .filter(
        (charge) =>
          !charge.clamped && charge.dunkAt < now && now < charge.liftAt,
      )
      .sort(compareCharges);
  }
}
