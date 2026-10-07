import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidGravityError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { GravityLedger } from "./ledger.js";
import {
  comparePans,
  isCooling,
  isSoured,
  Pan,
  PanRegistry,
  PanSnapshot,
  snapshotOf,
} from "./registry.js";

export interface CoolShipOptions {
  clock: VirtualClock;
  maxPans?: number;
  initialGravity?: number;
}

export interface DropResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  racked: PanSnapshot[];
  soured: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(dropAt: unknown, rackAt: unknown): void {
  if (
    typeof dropAt !== "number" ||
    typeof rackAt !== "number" ||
    !Number.isInteger(dropAt) ||
    !Number.isInteger(rackAt) ||
    dropAt < 0 ||
    rackAt < 0 ||
    rackAt <= dropAt
  ) {
    throw new InvalidSpanError(
      "dropAt/rackAt must be integers >= 0 with rackAt > dropAt",
    );
  }
}

function assertValidGravity(gravity: unknown): void {
  if (typeof gravity !== "number" || !Number.isInteger(gravity) || gravity < 1) {
    throw new InvalidGravityError("gravity must be an integer >= 1");
  }
}

export class CoolShip {
  private readonly clock: VirtualClock;
  private readonly registry: PanRegistry;
  private readonly ledger: GravityLedger;

  constructor(options: CoolShipOptions) {
    const maxPans = options?.maxPans ?? 5;
    const initialGravity = options?.initialGravity ?? 0;
    if (
      !options ||
      !options.clock ||
      typeof options.clock.now !== "function" ||
      !Number.isInteger(maxPans) ||
      maxPans < 1 ||
      !Number.isInteger(initialGravity) ||
      initialGravity < 0
    ) {
      throw new InvalidConfigError(
        "config requires a clock, integer maxPans >= 1, integer initialGravity >= 0",
      );
    }
    this.clock = options.clock;
    this.registry = new PanRegistry(maxPans);
    this.ledger = new GravityLedger(initialGravity);
  }

  drop(
    id: string,
    payload: unknown,
    dropAt: number,
    rackAt: number,
    gravity = 1,
  ): DropResult {
    assertValidId(id);
    assertValidSpan(dropAt, rackAt);
    assertValidGravity(gravity);
    const pan: Pan = { id, payload, dropAt, rackAt, gravity };
    if (this.registry.has(id)) {
      this.registry.update(pan);
      return { status: "updated" };
    }
    if (this.registry.isFull()) {
      throw new CapacityError("coolship is at capacity");
    }
    this.registry.register(pan);
    return { status: "accepted" };
  }

  restow(id: string, dropAt: number, rackAt: number): boolean {
    assertValidId(id);
    assertValidSpan(dropAt, rackAt);
    const pan = this.registry.get(id);
    if (!pan) {
      return false;
    }
    pan.dropAt = dropAt;
    pan.rackAt = rackAt;
    this.registry.setFoamed(id, true);
    return true;
  }

  dump(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id) !== undefined;
  }

  foam(id: string): boolean {
    assertValidId(id);
    this.requireKnown(id);
    this.registry.setFoamed(id, true);
    return true;
  }

  skim(id: string): boolean {
    assertValidId(id);
    this.requireKnown(id);
    this.registry.setFoamed(id, false);
    return true;
  }

  isFoamed(id: string): boolean {
    assertValidId(id);
    this.requireKnown(id);
    return this.registry.isFoamed(id) === true;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  gravity(): number {
    return this.ledger.available();
  }

  peek(): PanSnapshot | null {
    const head = this.rankedCandidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): PanSnapshot | null {
    const target = this.rankedCandidates().find((pan) =>
      this.ledger.canAfford(pan.gravity),
    );
    if (!target) {
      return null;
    }
    this.ledger.spend(target.gravity);
    this.registry.remove(target.id);
    return snapshotOf(target);
  }

  coolIds(): string[] {
    return this.rankedCandidates().map((pan) => pan.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const soured: string[] = [];
    for (const { pan, foamed } of this.registry.all()) {
      if (!foamed && isSoured(pan, now)) {
        soured.push(pan.id);
      }
    }
    for (const id of soured) {
      this.registry.remove(id);
    }
    const racked: PanSnapshot[] = [];
    for (const pan of this.rankedCandidates(now)) {
      if (!this.ledger.canAfford(pan.gravity)) {
        continue;
      }
      this.ledger.spend(pan.gravity);
      this.registry.remove(pan.id);
      racked.push(snapshotOf(pan));
    }
    return { racked, soured };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { dropAt: number; rackAt: number } | null {
    assertValidId(id);
    const pan = this.registry.get(id);
    return pan ? { dropAt: pan.dropAt, rackAt: pan.rackAt } : null;
  }

  gravityOf(id: string): number | null {
    assertValidId(id);
    const pan = this.registry.get(id);
    return pan ? pan.gravity : null;
  }

  private requireKnown(id: string): void {
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown pan id: ${id}`);
    }
  }

  private rankedCandidates(now: number = this.clock.now()): Pan[] {
    const seq = new Map<string, number>();
    this.registry.ids().forEach((id, index) => seq.set(id, index));
    const seqOf = (id: string): number => seq.get(id) ?? 0;
    return this.registry
      .all()
      .filter(({ pan, foamed }) => !foamed && isCooling(pan, now))
      .map(({ pan }) => pan)
      .sort((a, b) => comparePans(a, b, seqOf));
  }
}
