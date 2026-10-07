import { VirtualClock } from "./clock.js";
import { ChillLedger } from "./ledger.js";
import {
  CapacityError,
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import {
  Parcel,
  ParcelRegistry,
  compareDrawOrder,
  validateChill,
  validateId,
  validateSpan,
} from "./registry.js";

export interface RimeVaultOptions {
  clock: VirtualClock;
  maxParcels?: number;
  initialChill?: number;
}

export interface ParcelSnapshot {
  id: string;
  payload: unknown;
  rimeAt: number;
  thawAt: number;
  chill: number;
}

export interface DriveResult {
  drawn: ParcelSnapshot[];
  thawed: string[];
}

function snapshotOf(parcel: Parcel): ParcelSnapshot {
  return {
    id: parcel.id,
    payload: parcel.payload,
    rimeAt: parcel.rimeAt,
    thawAt: parcel.thawAt,
    chill: parcel.chill,
  };
}

export class RimeVault {
  private readonly clock: VirtualClock;
  private readonly maxParcels: number;
  private readonly ledger: ChillLedger;
  private readonly registry = new ParcelRegistry();

  constructor(options: RimeVaultOptions) {
    const maxParcels = options.maxParcels ?? 5;
    const initialChill = options.initialChill ?? 0;
    if (!Number.isInteger(maxParcels) || maxParcels < 1) {
      throw new InvalidConfigError("maxParcels must be an integer >= 1");
    }
    if (!Number.isInteger(initialChill) || initialChill < 0) {
      throw new InvalidConfigError("initialChill must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxParcels = maxParcels;
    this.ledger = new ChillLedger(initialChill);
  }

  store(
    id: string,
    payload: unknown,
    rimeAt: number,
    thawAt: number,
    chill = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(rimeAt, thawAt);
    validateChill(chill);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.rimeAt = rimeAt;
      existing.thawAt = thawAt;
      existing.chill = chill;
      existing.sealed = true;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxParcels) {
      throw new CapacityError("vault is at capacity");
    }
    this.registry.register(id, payload, rimeAt, thawAt, chill);
    return { status: "accepted" };
  }

  retime(id: string, rimeAt: number, thawAt: number): boolean {
    validateId(id);
    validateSpan(rimeAt, thawAt);
    const parcel = this.registry.get(id);
    if (!parcel) return false;
    parcel.rimeAt = rimeAt;
    parcel.thawAt = thawAt;
    return true;
  }

  drop(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  seal(id: string): boolean {
    validateId(id);
    const parcel = this.registry.get(id);
    if (!parcel) throw new UnknownIdError(`unknown id: ${id}`);
    parcel.sealed = true;
    return true;
  }

  unseal(id: string): boolean {
    validateId(id);
    const parcel = this.registry.get(id);
    if (!parcel) throw new UnknownIdError(`unknown id: ${id}`);
    parcel.sealed = false;
    return true;
  }

  isSealed(id: string): boolean {
    validateId(id);
    const parcel = this.registry.get(id);
    if (!parcel) throw new UnknownIdError(`unknown id: ${id}`);
    return parcel.sealed;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  chill(): number {
    return this.ledger.available();
  }

  peek(): ParcelSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): ParcelSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    if (!head || !this.ledger.canAfford(head.chill)) return null;
    this.ledger.spend(head.chill);
    this.registry.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((parcel) => parcel.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const thawed: string[] = [];
    for (const parcel of this.registry.inFirstStoreOrder()) {
      if (!parcel.sealed && now >= parcel.thawAt) {
        this.registry.remove(parcel.id);
        thawed.push(parcel.id);
      }
    }
    const drawn: ParcelSnapshot[] = [];
    for (const parcel of this.candidates(now)) {
      if (!this.ledger.canAfford(parcel.chill)) break;
      this.ledger.spend(parcel.chill);
      this.registry.remove(parcel.id);
      drawn.push(snapshotOf(parcel));
    }
    return { drawn, thawed };
  }

  ids(): string[] {
    return this.registry.inFirstStoreOrder().map((parcel) => parcel.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { rimeAt: number; thawAt: number } | null {
    validateId(id);
    const parcel = this.registry.get(id);
    if (!parcel) return null;
    return { rimeAt: parcel.rimeAt, thawAt: parcel.thawAt };
  }

  chillOf(id: string): number | null {
    validateId(id);
    const parcel = this.registry.get(id);
    return parcel ? parcel.chill : null;
  }

  private candidates(now: number): Parcel[] {
    return this.registry
      .inFirstStoreOrder()
      .filter(
        (parcel) =>
          !parcel.sealed && now >= parcel.rimeAt && now < parcel.thawAt,
      )
      .sort(compareDrawOrder);
  }
}
