import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSoapError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { SoapLedger } from "./ledger.js";
import {
  Bolt,
  BoltRegistry,
  BoltSnapshot,
  compareCandidates,
  isInWindow,
  isSpent,
  snapshotOf,
} from "./registry.js";

export interface FullStockOptions {
  clock: VirtualClock;
  maxBolts?: number;
  initialSoap?: number;
}

export interface StoreResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  milled: BoltSnapshot[];
  spent: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(millAt: unknown, beatAt: unknown): void {
  if (
    typeof millAt !== "number" ||
    !Number.isInteger(millAt) ||
    millAt < 0 ||
    typeof beatAt !== "number" ||
    !Number.isInteger(beatAt) ||
    beatAt < 0 ||
    beatAt <= (millAt as number)
  ) {
    throw new InvalidSpanError(
      "millAt/beatAt must be integers >= 0 with beatAt > millAt",
    );
  }
}

function assertValidSoap(soap: unknown): void {
  if (typeof soap !== "number" || !Number.isInteger(soap) || soap < 1) {
    throw new InvalidSoapError("soap must be an integer >= 1");
  }
}

export class FullStock {
  private readonly clock: VirtualClock;
  private readonly maxBolts: number;
  private readonly registry = new BoltRegistry();
  private readonly ledger: SoapLedger;

  constructor(options: FullStockOptions) {
    const { clock, maxBolts = 5, initialSoap = 0 } = options ?? {};
    if (
      !clock ||
      typeof clock.now !== "function" ||
      !Number.isInteger(maxBolts) ||
      maxBolts < 1 ||
      !Number.isInteger(initialSoap) ||
      initialSoap < 0
    ) {
      throw new InvalidConfigError(
        "config requires a clock, integer maxBolts >= 1, integer initialSoap >= 0",
      );
    }
    this.clock = clock;
    this.maxBolts = maxBolts;
    this.ledger = new SoapLedger(initialSoap);
  }

  store(
    id: string,
    payload: unknown,
    millAt: number,
    beatAt: number,
    soap = 1,
  ): StoreResult {
    assertValidId(id);
    assertValidSpan(millAt, beatAt);
    assertValidSoap(soap);
    const existing = this.registry.get(id);
    if (existing) {
      this.registry.update(existing, payload, millAt, beatAt, soap);
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxBolts) {
      throw new CapacityError("registry is at capacity");
    }
    this.registry.insert(id, payload, millAt, beatAt, soap);
    return { status: "accepted" };
  }

  remill(id: string, millAt: number, beatAt: number): boolean {
    assertValidId(id);
    assertValidSpan(millAt, beatAt);
    const bolt = this.registry.get(id);
    if (!bolt) return false;
    this.registry.remill(bolt, millAt, beatAt);
    return true;
  }

  drop(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  peg(id: string): boolean {
    this.known(id).pegged = true;
    return true;
  }

  unpeg(id: string): boolean {
    this.known(id).pegged = false;
    return true;
  }

  isPegged(id: string): boolean {
    return this.known(id).pegged;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  soap(): number {
    return this.ledger.available();
  }

  peek(): BoltSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): BoltSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    if (!head || !this.ledger.canAfford(head.soap)) return null;
    this.ledger.spend(head.soap);
    this.registry.remove(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((bolt) => bolt.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const bolt of this.registry.inFirstStoreOrder()) {
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
    return this.registry.inFirstStoreOrder().map((bolt) => bolt.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { millAt: number; beatAt: number } | null {
    assertValidId(id);
    const bolt = this.registry.get(id);
    if (!bolt) return null;
    return { millAt: bolt.millAt, beatAt: bolt.beatAt };
  }

  soapOf(id: string): number | null {
    assertValidId(id);
    const bolt = this.registry.get(id);
    return bolt ? bolt.soap : null;
  }

  private known(id: string): Bolt {
    assertValidId(id);
    const bolt = this.registry.get(id);
    if (!bolt) throw new UnknownIdError(`unknown id: ${id}`);
    return bolt;
  }

  private candidates(now: number): Bolt[] {
    return this.registry
      .inFirstStoreOrder()
      .filter((bolt) => !bolt.pegged && isInWindow(bolt, now))
      .sort(compareCandidates);
  }
}
