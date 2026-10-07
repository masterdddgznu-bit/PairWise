import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidChillError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { ChillLedger } from "./ledger.js";
import { compareRank, ParcelRecord, ParcelRegistry } from "./registry.js";

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

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isValidSpan(rimeAt: unknown, thawAt: unknown): boolean {
  return (
    typeof rimeAt === "number" &&
    Number.isInteger(rimeAt) &&
    rimeAt >= 0 &&
    typeof thawAt === "number" &&
    Number.isInteger(thawAt) &&
    thawAt >= 0 &&
    thawAt > rimeAt
  );
}

function isValidChill(chill: unknown): boolean {
  return typeof chill === "number" && Number.isInteger(chill) && chill >= 1;
}

function snapshotOf(record: ParcelRecord): ParcelSnapshot {
  return {
    id: record.id,
    payload: record.payload,
    rimeAt: record.rimeAt,
    thawAt: record.thawAt,
    chill: record.chill,
  };
}

export class RimeVault {
  private readonly clock: VirtualClock;
  private readonly maxParcels: number;
  private readonly ledger: ChillLedger;
  private readonly registry = new ParcelRegistry();

  constructor(options: RimeVaultOptions) {
    const maxParcels = options?.maxParcels ?? 5;
    const initialChill = options?.initialChill ?? 0;
    if (
      !options ||
      !(options.clock instanceof VirtualClock) ||
      !Number.isInteger(maxParcels) ||
      maxParcels < 1 ||
      !Number.isInteger(initialChill) ||
      initialChill < 0
    ) {
      throw new InvalidConfigError(
        "config requires a VirtualClock, integer maxParcels >= 1, integer initialChill >= 0",
      );
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
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    if (!isValidSpan(rimeAt, thawAt)) {
      throw new InvalidSpanError("span requires finite integers 0 <= rimeAt < thawAt");
    }
    if (!isValidChill(chill)) {
      throw new InvalidChillError("chill must be a finite integer >= 1");
    }
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
    this.registry.add(id, payload, rimeAt, thawAt, chill);
    return { status: "accepted" };
  }

  retime(id: string, rimeAt: number, thawAt: number): boolean {
    if (!isValidSpan(rimeAt, thawAt)) {
      throw new InvalidSpanError("span requires finite integers 0 <= rimeAt < thawAt");
    }
    const record = this.registry.get(id);
    if (!record) {
      return false;
    }
    record.rimeAt = rimeAt;
    record.thawAt = thawAt;
    return true;
  }

  drop(id: string): boolean {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    return this.registry.remove(id);
  }

  seal(id: string): boolean {
    this.requireRecord(id).sealed = true;
    return true;
  }

  unseal(id: string): boolean {
    this.requireRecord(id).sealed = false;
    return true;
  }

  isSealed(id: string): boolean {
    return this.requireRecord(id).sealed;
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
    if (!head || !this.ledger.canAfford(head.chill)) {
      return null;
    }
    this.ledger.spend(head.chill);
    this.registry.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((record) => record.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const thawed: string[] = [];
    for (const record of this.registry.all()) {
      if (!record.sealed && now >= record.thawAt) {
        thawed.push(record.id);
      }
    }
    for (const id of thawed) {
      this.registry.remove(id);
    }
    const drawn: ParcelSnapshot[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (!head || !this.ledger.canAfford(head.chill)) {
        break;
      }
      this.ledger.spend(head.chill);
      this.registry.remove(head.id);
      drawn.push(snapshotOf(head));
    }
    return { drawn, thawed };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { rimeAt: number; thawAt: number } | null {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    const record = this.registry.get(id);
    return record ? { rimeAt: record.rimeAt, thawAt: record.thawAt } : null;
  }

  chillOf(id: string): number | null {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    const record = this.registry.get(id);
    return record ? record.chill : null;
  }

  private requireRecord(id: string): ParcelRecord {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
    const record = this.registry.get(id);
    if (!record) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return record;
  }

  private candidates(now: number): ParcelRecord[] {
    return this.registry
      .all()
      .filter(
        (record) => !record.sealed && record.rimeAt <= now && now < record.thawAt,
      )
      .sort(compareRank);
  }
}
