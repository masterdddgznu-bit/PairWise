import { ClampGate } from "./clamp.js";
import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import { Charge, ChargeRegistry, validateId } from "./registry.js";
import { FluxLedger } from "./ledger.js";

export { VirtualClock } from "./clock.js";
export {
  SlagQuenchError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidFluxError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

export interface SlagQuenchOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialFlux?: number;
}

export interface ChargeView {
  id: string;
  payload: unknown;
  dunkAt: number;
  liftAt: number;
  flux: number;
}

function viewOf(charge: Charge): ChargeView {
  return {
    id: charge.id,
    payload: charge.payload,
    dunkAt: charge.dunkAt,
    liftAt: charge.liftAt,
    flux: charge.flux,
  };
}

export class SlagQuench {
  private readonly clock: VirtualClock;
  private readonly registry: ChargeRegistry;
  private readonly gate = new ClampGate();
  private readonly ledger: FluxLedger;

  constructor(options: SlagQuenchOptions) {
    const maxCharges = options?.maxCharges ?? 5;
    const initialFlux = options?.initialFlux ?? 0;
    if (
      !options ||
      !options.clock ||
      typeof options.clock.now !== "function" ||
      !Number.isInteger(maxCharges) ||
      maxCharges < 1 ||
      !Number.isInteger(initialFlux) ||
      initialFlux < 0
    ) {
      throw new InvalidConfigError("invalid SlagQuench configuration");
    }
    this.clock = options.clock;
    this.registry = new ChargeRegistry(maxCharges);
    this.ledger = new FluxLedger(initialFlux);
  }

  store(
    id: string,
    payload: unknown,
    dunkAt: number,
    liftAt: number,
    flux = 1,
  ): { status: "accepted" | "updated" } {
    const result = this.registry.store(id, payload, dunkAt, liftAt, flux);
    if (result.isNew) {
      this.gate.clamp(id);
    }
    return { status: result.status };
  }

  retune(id: string, dunkAt: number, liftAt: number): boolean {
    const ok = this.registry.retune(id, dunkAt, liftAt);
    if (ok) {
      this.gate.unclamp(id);
    }
    return ok;
  }

  drop(id: string): boolean {
    const removed = this.registry.remove(id);
    if (removed) {
      this.gate.forget(id);
    }
    return removed;
  }

  clamp(id: string): boolean {
    this.requireKnown(id);
    this.gate.clamp(id);
    return true;
  }

  unclamp(id: string): boolean {
    this.requireKnown(id);
    this.gate.unclamp(id);
    return true;
  }

  isClamped(id: string): boolean {
    this.requireKnown(id);
    return this.gate.isClamped(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  flux(): number {
    return this.ledger.available();
  }

  peek(): ChargeView | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? viewOf(head) : null;
  }

  pop(): ChargeView | null {
    const head = this.candidates(this.clock.now())[0];
    if (!head || !this.ledger.canAfford(head.flux)) {
      return null;
    }
    this.ledger.spend(head.flux);
    this.registry.remove(head.id);
    this.gate.forget(head.id);
    return viewOf(head);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((charge) => charge.id);
  }

  drive(): { drawn: ChargeView[]; spent: string[] } {
    const now = this.clock.now();
    const drawn: ChargeView[] = [];
    for (const charge of this.candidates(now)) {
      if (!this.ledger.canAfford(charge.flux)) {
        break;
      }
      this.ledger.spend(charge.flux);
      this.registry.remove(charge.id);
      this.gate.forget(charge.id);
      drawn.push(viewOf(charge));
    }
    const spent: string[] = [];
    for (const charge of this.registry.entries()) {
      if (now >= charge.liftAt && !this.gate.isClamped(charge.id)) {
        this.registry.remove(charge.id);
        this.gate.forget(charge.id);
        spent.push(charge.id);
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

  spanOf(id: string): { dunkAt: number; liftAt: number } | null {
    validateId(id);
    const charge = this.registry.get(id);
    return charge
      ? { dunkAt: charge.dunkAt, liftAt: charge.liftAt }
      : null;
  }

  fluxOf(id: string): number | null {
    validateId(id);
    const charge = this.registry.get(id);
    return charge ? charge.flux : null;
  }

  private requireKnown(id: string): void {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private candidates(now: number): Charge[] {
    return this.registry
      .entries()
      .filter(
        (charge) =>
          !this.gate.isClamped(charge.id) &&
          charge.dunkAt < now &&
          now < charge.liftAt,
      )
      .sort(
        (a, b) =>
          a.dunkAt - b.dunkAt || b.flux - a.flux || a.seq - b.seq,
      );
  }
}
