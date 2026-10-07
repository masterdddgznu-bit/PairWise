import type { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSoapError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import {
  compareMillRank,
  isRipe,
  isSpent,
  Registry,
  snapshotOf,
  type Bolt,
  type BoltSnapshot,
} from "./registry.js";
import { SoapLedger } from "./soap-ledger.js";

export interface FullStockOptions {
  clock: VirtualClock;
  maxBolts?: number;
  initialSoap?: number;
}

export interface DriveResult {
  milled: BoltSnapshot[];
  spent: string[];
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(millAt: number, beatAt: number): void {
  if (
    !Number.isInteger(millAt) ||
    !Number.isInteger(beatAt) ||
    millAt < 0 ||
    beatAt < 0 ||
    beatAt <= millAt
  ) {
    throw new InvalidSpanError(
      "millAt/beatAt must be integers >= 0 with beatAt > millAt",
    );
  }
}

function assertSoap(soap: number): void {
  if (!Number.isInteger(soap) || soap < 1) {
    throw new InvalidSoapError("soap must be an integer >= 1");
  }
}

export class FullStock {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly ledger: SoapLedger;

  constructor(options: FullStockOptions) {
    const maxBolts = options.maxBolts ?? 5;
    const initialSoap = options.initialSoap ?? 0;
    if (!Number.isInteger(maxBolts) || maxBolts < 1) {
      throw new InvalidConfigError("maxBolts must be an integer >= 1");
    }
    if (!Number.isInteger(initialSoap) || initialSoap < 0) {
      throw new InvalidConfigError("initialSoap must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new Registry(maxBolts);
    this.ledger = new SoapLedger(initialSoap);
  }

  store(
    id: string,
    payload: unknown,
    millAt: number,
    beatAt: number,
    soap = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(millAt, beatAt);
    assertSoap(soap);
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.millAt = millAt;
      existing.beatAt = beatAt;
      existing.soap = soap;
      existing.pegged = false;
      return { status: "updated" };
    }
    if (!this.registry.hasCapacityForNew()) {
      throw new CapacityError("registry is at capacity");
    }
    this.registry.add(id, payload, millAt, beatAt, soap);
    return { status: "accepted" };
  }

  remill(id: string, millAt: number, beatAt: number): boolean {
    assertId(id);
    assertSpan(millAt, beatAt);
    const bolt = this.registry.get(id);
    if (!bolt) return false;
    bolt.millAt = millAt;
    bolt.beatAt = beatAt;
    bolt.pegged = true;
    return true;
  }

  drop(id: string): boolean {
    assertId(id);
    return this.registry.remove(id);
  }

  peg(id: string): boolean {
    return this.setPeg(id, true);
  }

  unpeg(id: string): boolean {
    return this.setPeg(id, false);
  }

  isPegged(id: string): boolean {
    assertId(id);
    const bolt = this.registry.get(id);
    if (!bolt) throw new UnknownIdError(`unknown id: ${id}`);
    return bolt.pegged;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  soap(): number {
    return this.ledger.value();
  }

  peek(): BoltSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): BoltSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.soap)) return null;
    this.ledger.spend(head.soap);
    this.registry.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((bolt) => bolt.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const bolt of this.registry.inStoreOrder()) {
      if (!bolt.pegged && isSpent(bolt, now)) {
        this.registry.remove(bolt.id);
        spent.push(bolt.id);
      }
    }
    const milled: BoltSnapshot[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (!head || !this.ledger.canAfford(head.soap)) break;
      this.ledger.spend(head.soap);
      this.registry.remove(head.id);
      milled.push(snapshotOf(head));
    }
    return { milled, spent };
  }

  ids(): string[] {
    return this.registry.inStoreOrder().map((bolt) => bolt.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { millAt: number; beatAt: number } | null {
    assertId(id);
    const bolt = this.registry.get(id);
    if (!bolt) return null;
    return { millAt: bolt.millAt, beatAt: bolt.beatAt };
  }

  soapOf(id: string): number | null {
    assertId(id);
    const bolt = this.registry.get(id);
    return bolt ? bolt.soap : null;
  }

  private setPeg(id: string, pegged: boolean): boolean {
    assertId(id);
    const bolt = this.registry.get(id);
    if (!bolt) throw new UnknownIdError(`unknown id: ${id}`);
    bolt.pegged = pegged;
    return true;
  }

  private candidates(now = this.clock.now()): Bolt[] {
    return this.registry
      .inStoreOrder()
      .filter((bolt) => !bolt.pegged && isRipe(bolt, now))
      .sort(compareMillRank);
  }
}
