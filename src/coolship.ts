import { VirtualClock } from "./clock.js";
import { GravityLedger } from "./ledger.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidGravityError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface Dish {
  id: string;
  payload: unknown;
  dropAt: number;
  rackAt: number;
  gravity: number;
}

export interface DriveResult {
  racked: Dish[];
  soured: string[];
}

interface Pan {
  id: string;
  payload: unknown;
  dropAt: number;
  rackAt: number;
  gravity: number;
  foamed: boolean;
  seq: number;
}

export interface CoolShipOptions {
  clock: VirtualClock;
  maxPans?: number;
  initialGravity?: number;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export class CoolShip {
  private readonly clock: VirtualClock;
  private readonly maxPans: number;
  private readonly ledger: GravityLedger;
  private readonly pans = new Map<string, Pan>();
  private nextSeq = 0;

  constructor(options: CoolShipOptions) {
    const { clock, maxPans = 5, initialGravity = 0 } = options ?? ({} as CoolShipOptions);
    if (!clock || typeof clock.now !== "function" || typeof clock.advance !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxPans) || maxPans < 1) {
      throw new InvalidConfigError("maxPans must be an integer >= 1");
    }
    if (!isNonNegativeInt(initialGravity)) {
      throw new InvalidConfigError("initialGravity must be an integer >= 0");
    }
    this.clock = clock;
    this.maxPans = maxPans;
    this.ledger = new GravityLedger(initialGravity);
  }

  private static checkId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private static checkSpan(dropAt: unknown, rackAt: unknown): void {
    if (!isNonNegativeInt(dropAt) || !isNonNegativeInt(rackAt) || rackAt <= dropAt) {
      throw new InvalidSpanError("span requires finite integers >= 0 with rackAt > dropAt");
    }
  }

  private static checkGravity(gravity: unknown): void {
    if (!Number.isInteger(gravity) || (gravity as number) < 1) {
      throw new InvalidGravityError("gravity must be an integer >= 1");
    }
  }

  private require(id: string): Pan {
    const pan = this.pans.get(id);
    if (!pan) {
      throw new UnknownIdError(`unknown pan id: ${id}`);
    }
    return pan;
  }

  private inWindow(pan: Pan, now: number): boolean {
    return pan.dropAt < now && now <= pan.rackAt;
  }

  private souredAt(pan: Pan, now: number): boolean {
    return now > pan.rackAt;
  }

  private candidatesAt(now: number): Pan[] {
    const result: Pan[] = [];
    for (const pan of this.pans.values()) {
      if (!pan.foamed && this.inWindow(pan, now)) {
        result.push(pan);
      }
    }
    result.sort((a, b) => a.rackAt - b.rackAt || b.gravity - a.gravity || a.seq - b.seq);
    return result;
  }

  private static toDish(pan: Pan): Dish {
    return {
      id: pan.id,
      payload: pan.payload,
      dropAt: pan.dropAt,
      rackAt: pan.rackAt,
      gravity: pan.gravity,
    };
  }

  drop(
    id: string,
    payload: unknown,
    dropAt: number,
    rackAt: number,
    gravity = 1,
  ): { status: "accepted" | "updated" } {
    CoolShip.checkId(id);
    CoolShip.checkSpan(dropAt, rackAt);
    CoolShip.checkGravity(gravity);
    const existing = this.pans.get(id);
    if (existing) {
      existing.payload = payload;
      existing.dropAt = dropAt;
      existing.rackAt = rackAt;
      existing.gravity = gravity;
      return { status: "updated" };
    }
    if (this.pans.size >= this.maxPans) {
      throw new CapacityError("coolship is at capacity");
    }
    this.pans.set(id, {
      id,
      payload,
      dropAt,
      rackAt,
      gravity,
      foamed: true,
      seq: this.nextSeq++,
    });
    return { status: "accepted" };
  }

  restow(id: string, dropAt: number, rackAt: number): boolean {
    CoolShip.checkId(id);
    CoolShip.checkSpan(dropAt, rackAt);
    const pan = this.pans.get(id);
    if (!pan) {
      return false;
    }
    pan.dropAt = dropAt;
    pan.rackAt = rackAt;
    pan.foamed = true;
    return true;
  }

  dump(id: string): boolean {
    CoolShip.checkId(id);
    return this.pans.delete(id);
  }

  foam(id: string): boolean {
    CoolShip.checkId(id);
    this.require(id).foamed = true;
    return true;
  }

  skim(id: string): boolean {
    CoolShip.checkId(id);
    this.require(id).foamed = false;
    return true;
  }

  isFoamed(id: string): boolean {
    CoolShip.checkId(id);
    return this.require(id).foamed;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  gravity(): number {
    return this.ledger.available();
  }

  peek(): Dish | null {
    const candidates = this.candidatesAt(this.clock.now());
    return candidates.length === 0 ? null : CoolShip.toDish(candidates[0]);
  }

  pop(): Dish | null {
    const candidates = this.candidatesAt(this.clock.now());
    for (const pan of candidates) {
      if (this.ledger.canAfford(pan.gravity)) {
        this.ledger.spend(pan.gravity);
        this.pans.delete(pan.id);
        return CoolShip.toDish(pan);
      }
    }
    return null;
  }

  coolIds(): string[] {
    return this.candidatesAt(this.clock.now()).map((pan) => pan.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const soured: string[] = [];
    for (const pan of this.pans.values()) {
      if (!pan.foamed && this.souredAt(pan, now)) {
        soured.push(pan.id);
      }
    }
    for (const id of soured) {
      this.pans.delete(id);
    }
    const racked: Dish[] = [];
    for (const pan of this.candidatesAt(now)) {
      if (this.ledger.canAfford(pan.gravity)) {
        this.ledger.spend(pan.gravity);
        this.pans.delete(pan.id);
        racked.push(CoolShip.toDish(pan));
      }
    }
    return { racked, soured };
  }

  ids(): string[] {
    return [...this.pans.keys()];
  }

  size(): number {
    return this.pans.size;
  }

  spanOf(id: string): { dropAt: number; rackAt: number } | null {
    CoolShip.checkId(id);
    const pan = this.pans.get(id);
    return pan ? { dropAt: pan.dropAt, rackAt: pan.rackAt } : null;
  }

  gravityOf(id: string): number | null {
    CoolShip.checkId(id);
    const pan = this.pans.get(id);
    return pan ? pan.gravity : null;
  }
}
