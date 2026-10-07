import { VirtualClock } from "./clock.js";
import { InvalidConfigError } from "./errors.js";
import { FlowLedger } from "./ledger.js";
import {
  Parcel,
  ParcelSnapshot,
  Registry,
  snapshotOf,
  validateFlow,
  validateId,
  validateSpan,
} from "./registry.js";

export interface MillRaceOptions {
  clock: VirtualClock;
  maxParcels?: number;
  initialCredit?: number;
}

function isLive(parcel: Parcel, now: number): boolean {
  return parcel.crestAt <= now && now < parcel.spillAt;
}

function isSpent(parcel: Parcel, now: number): boolean {
  return now >= parcel.spillAt;
}

function compareRank(a: Parcel, b: Parcel): number {
  if (a.spillAt !== b.spillAt) return a.spillAt - b.spillAt;
  if (a.flow !== b.flow) return b.flow - a.flow;
  return a.seq - b.seq;
}

export class MillRace {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly ledger: FlowLedger;

  constructor(options: MillRaceOptions) {
    const maxParcels = options.maxParcels ?? 5;
    const initialCredit = options.initialCredit ?? 0;
    if (!Number.isInteger(maxParcels) || maxParcels < 1) {
      throw new InvalidConfigError("maxParcels must be an integer >= 1");
    }
    if (!Number.isInteger(initialCredit) || initialCredit < 0) {
      throw new InvalidConfigError("initialCredit must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new Registry(maxParcels);
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
    return { status: this.registry.admit(id, payload, crestAt, spillAt, flow) };
  }

  retune(id: string, crestAt: number, spillAt: number): boolean {
    validateId(id);
    validateSpan(crestAt, spillAt);
    const parcel = this.registry.get(id);
    if (!parcel) return false;
    parcel.crestAt = crestAt;
    parcel.spillAt = spillAt;
    parcel.latched = false;
    return true;
  }

  dump(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  latch(id: string): boolean {
    validateId(id);
    this.registry.require(id).latched = true;
    return true;
  }

  unlatch(id: string): boolean {
    validateId(id);
    this.registry.require(id).latched = false;
    return true;
  }

  isLatched(id: string): boolean {
    validateId(id);
    return this.registry.require(id).latched;
  }

  endow(amount: number): number {
    return this.ledger.endow(amount);
  }

  credit(): number {
    return this.ledger.credit();
  }

  peek(): ParcelSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  haul(): ParcelSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.flow)) return null;
    this.ledger.spend(head.flow);
    this.registry.remove(head.id);
    return snapshotOf(head);
  }

  liveIds(): string[] {
    return this.candidates().map((parcel) => parcel.id);
  }

  flush(): { hauled: ParcelSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const parcel of this.registry.inAdmitOrder()) {
      if (!parcel.latched && isSpent(parcel, now)) {
        this.registry.remove(parcel.id);
        spent.push(parcel.id);
      }
    }
    const hauled: ParcelSnapshot[] = [];
    for (;;) {
      const head = this.candidates()[0];
      if (!head || !this.ledger.canAfford(head.flow)) break;
      this.ledger.spend(head.flow);
      this.registry.remove(head.id);
      hauled.push(snapshotOf(head));
    }
    return { hauled, spent };
  }

  ids(): string[] {
    return this.registry.inAdmitOrder().map((parcel) => parcel.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { crestAt: number; spillAt: number } | null {
    validateId(id);
    const parcel = this.registry.get(id);
    if (!parcel) return null;
    return { crestAt: parcel.crestAt, spillAt: parcel.spillAt };
  }

  flowOf(id: string): number | null {
    validateId(id);
    const parcel = this.registry.get(id);
    return parcel ? parcel.flow : null;
  }

  private candidates(): Parcel[] {
    const now = this.clock.now();
    return this.registry
      .inAdmitOrder()
      .filter((parcel) => !parcel.latched && isLive(parcel, now))
      .sort(compareRank);
  }
}
