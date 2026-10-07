import { InvalidConfigError, UnknownIdError } from "./errors.js";
import { VirtualClock } from "./clock.js";
import { FlowLedger } from "./ledger.js";
import { GateKeeper } from "./gate.js";
import {
  Parcel,
  ParcelRegistry,
  compareParcels,
  validateFlow,
  validateId,
  validateSpan,
} from "./registry.js";

export interface ParcelView {
  id: string;
  payload: unknown;
  crestAt: number;
  spillAt: number;
  flow: number;
}

export interface MillRaceOptions {
  clock: VirtualClock;
  maxParcels?: number;
  initialCredit?: number;
}

function viewOf(parcel: Parcel): ParcelView {
  return {
    id: parcel.id,
    payload: parcel.payload,
    crestAt: parcel.crestAt,
    spillAt: parcel.spillAt,
    flow: parcel.flow,
  };
}

export class MillRace {
  private readonly clock: VirtualClock;
  private readonly registry: ParcelRegistry;
  private readonly gate = new GateKeeper();
  private readonly ledger: FlowLedger;

  constructor(options: MillRaceOptions) {
    const { clock, maxParcels = 5, initialCredit = 0 } = options ?? {};
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxParcels) || maxParcels < 1) {
      throw new InvalidConfigError("maxParcels must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = clock;
    this.registry = new ParcelRegistry(maxParcels);
    this.ledger = new FlowLedger(initialCredit);
  }

  admit(
    id: string,
    payload: unknown,
    crestAt: number,
    spillAt: number,
    flow = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(crestAt, spillAt);
    validateFlow(flow);
    const status = this.registry.admit(id, payload, crestAt, spillAt, flow);
    if (status === "accepted") {
      this.gate.latch(id);
    }
    return { status };
  }

  retune(id: string, crestAt: number, spillAt: number): boolean {
    validateSpan(crestAt, spillAt);
    const changed = this.registry.retune(id, crestAt, spillAt);
    if (changed) {
      this.gate.unlatch(id);
    }
    return changed;
  }

  dump(id: string): boolean {
    validateId(id);
    const removed = this.registry.remove(id);
    if (removed) {
      this.gate.forget(id);
    }
    return removed;
  }

  latch(id: string): boolean {
    this.requireKnown(id);
    this.gate.latch(id);
    return true;
  }

  unlatch(id: string): boolean {
    this.requireKnown(id);
    this.gate.unlatch(id);
    return true;
  }

  isLatched(id: string): boolean {
    this.requireKnown(id);
    return this.gate.isLatched(id);
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): ParcelView | null {
    const head = this.candidates()[0];
    return head ? viewOf(head) : null;
  }

  haul(): ParcelView | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.trySpend(head.flow)) {
      return null;
    }
    this.evict(head.id);
    return viewOf(head);
  }

  liveIds(): string[] {
    return this.candidates().map((parcel) => parcel.id);
  }

  flush(): { hauled: ParcelView[]; spent: string[] } {
    const now = this.clock.now();
    const spent = this.registry
      .entries()
      .filter((parcel) => now >= parcel.spillAt && !this.gate.isLatched(parcel.id))
      .map((parcel) => parcel.id);
    for (const id of spent) {
      this.evict(id);
    }
    const hauled: ParcelView[] = [];
    for (;;) {
      const head = this.candidates()[0];
      if (!head || !this.ledger.trySpend(head.flow)) {
        break;
      }
      this.evict(head.id);
      hauled.push(viewOf(head));
    }
    return { hauled, spent };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { crestAt: number; spillAt: number } | null {
    validateId(id);
    const parcel = this.registry.get(id);
    return parcel
      ? { crestAt: parcel.crestAt, spillAt: parcel.spillAt }
      : null;
  }

  flowOf(id: string): number | null {
    validateId(id);
    const parcel = this.registry.get(id);
    return parcel ? parcel.flow : null;
  }

  private candidates(): Parcel[] {
    const now = this.clock.now();
    return this.registry
      .entries()
      .filter(
        (parcel) =>
          !this.gate.isLatched(parcel.id) &&
          parcel.crestAt <= now &&
          now < parcel.spillAt,
      )
      .sort(compareParcels);
  }

  private evict(id: string): void {
    this.registry.remove(id);
    this.gate.forget(id);
  }

  private requireKnown(id: string): void {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }
}
