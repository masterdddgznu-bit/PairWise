import { BaffleGate } from "./baffle.js";
import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { SodaLedger } from "./ledger.js";
import {
  Rack,
  RackRegistry,
  RackSnapshot,
  snapshotOf,
} from "./registry.js";

export interface KelpAshOptions {
  clock: VirtualClock;
  maxRacks?: number;
  initialSoda?: number;
}

export interface ChargeResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  drawn: RackSnapshot[];
  washed: string[];
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isValidSpanValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export class KelpAsh {
  private readonly clock: VirtualClock;
  private readonly registry: RackRegistry;
  private readonly gate = new BaffleGate();
  private readonly ledger: SodaLedger;

  constructor(options: KelpAshOptions) {
    const maxRacks = options.maxRacks ?? 5;
    const initialSoda = options.initialSoda ?? 0;
    if (!Number.isInteger(maxRacks) || maxRacks < 1) {
      throw new InvalidConfigError("maxRacks must be an integer >= 1");
    }
    if (!Number.isInteger(initialSoda) || initialSoda < 0) {
      throw new InvalidConfigError("initialSoda must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new RackRegistry(maxRacks);
    this.ledger = new SodaLedger(initialSoda);
  }

  charge(
    id: string,
    payload: unknown,
    chargeAt: number,
    drawAt: number,
    cost = 1,
  ): ChargeResult {
    this.assertId(id);
    this.assertSpan(chargeAt, drawAt);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.chargeAt = chargeAt;
      existing.drawAt = drawAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.isFull) {
      throw new CapacityError("rack capacity reached");
    }
    this.registry.add({ id, payload, chargeAt, drawAt, cost });
    return { status: "accepted" };
  }

  recharge(id: string, chargeAt: number, drawAt: number): boolean {
    this.assertId(id);
    this.assertSpan(chargeAt, drawAt);
    const rack = this.registry.get(id);
    if (!rack) {
      return false;
    }
    rack.chargeAt = chargeAt;
    rack.drawAt = drawAt;
    return true;
  }

  rake(id: string): boolean {
    this.assertId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.gate.clear(id);
    return true;
  }

  baffle(id: string): boolean {
    this.gate.baffle(this.knownId(id));
    return true;
  }

  unbaffle(id: string): boolean {
    this.gate.unbaffle(this.knownId(id));
    return true;
  }

  isBaffled(id: string): boolean {
    return this.gate.isBaffled(this.knownId(id));
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  soda(): number {
    return this.ledger.soda();
  }

  peek(): RackSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): RackSnapshot | null {
    const target = this.candidates().find((rack) =>
      this.ledger.canAfford(rack.cost),
    );
    if (!target) {
      return null;
    }
    this.ledger.spend(target.cost);
    this.registry.remove(target.id);
    this.gate.clear(target.id);
    return snapshotOf(target);
  }

  ripeIds(): string[] {
    return this.candidates().map((rack) => rack.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: RackSnapshot[] = [];
    const ripe = this.ranked(
      this.registry
        .entries()
        .filter(
          (rack) =>
            !this.gate.isBaffled(rack.id) && this.isRipe(rack, now),
        ),
    );
    for (const rack of ripe) {
      if (!this.ledger.canAfford(rack.cost)) {
        continue;
      }
      this.ledger.spend(rack.cost);
      this.registry.remove(rack.id);
      this.gate.clear(rack.id);
      drawn.push(snapshotOf(rack));
    }
    const washed: string[] = [];
    for (const rack of this.registry.entries()) {
      if (this.gate.isBaffled(rack.id) || now < rack.drawAt) {
        continue;
      }
      this.registry.remove(rack.id);
      this.gate.clear(rack.id);
      washed.push(rack.id);
    }
    return { drawn, washed };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { chargeAt: number; drawAt: number } | null {
    this.assertId(id);
    const rack = this.registry.get(id);
    if (!rack) {
      return null;
    }
    return { chargeAt: rack.chargeAt, drawAt: rack.drawAt };
  }

  costOf(id: string): number | null {
    this.assertId(id);
    return this.registry.get(id)?.cost ?? null;
  }

  private candidates(): Rack[] {
    const now = this.clock.now();
    return this.ranked(
      this.registry
        .entries()
        .filter(
          (rack) =>
            !this.gate.isBaffled(rack.id) && this.isRipe(rack, now),
        ),
    );
  }

  private isRipe(rack: Rack, now: number): boolean {
    return rack.chargeAt <= now && now < rack.drawAt;
  }

  private ranked(racks: Rack[]): Rack[] {
    return racks.sort((a, b) => {
      if (a.drawAt !== b.drawAt) {
        return a.drawAt - b.drawAt;
      }
      if (a.cost !== b.cost) {
        return b.cost - a.cost;
      }
      return 0;
    });
  }

  private assertId(id: unknown): asserts id is string {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private assertSpan(chargeAt: unknown, drawAt: unknown): void {
    if (
      !isValidSpanValue(chargeAt) ||
      !isValidSpanValue(drawAt) ||
      drawAt <= chargeAt
    ) {
      throw new InvalidSpanError(
        "span requires integer chargeAt/drawAt >= 0 with drawAt > chargeAt",
      );
    }
  }

  private knownId(id: unknown): string {
    this.assertId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return id;
  }
}
