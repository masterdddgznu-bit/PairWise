import type { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { BaffleGate } from "./baffle-gate.js";
import { RackRegistry, type Rack } from "./rack-registry.js";
import { SodaLedger } from "./soda-ledger.js";

export interface KelpAshOptions {
  clock: VirtualClock;
  maxRacks?: number;
  initialSoda?: number;
}

export interface RackSnapshot {
  id: string;
  payload: unknown;
  chargeAt: number;
  drawAt: number;
  cost: number;
}

export interface DriveResult {
  drawn: RackSnapshot[];
  washed: string[];
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isValidSpan(chargeAt: unknown, drawAt: unknown): boolean {
  return (
    Number.isInteger(chargeAt) &&
    Number.isInteger(drawAt) &&
    (chargeAt as number) >= 0 &&
    (drawAt as number) >= 0 &&
    (drawAt as number) > (chargeAt as number)
  );
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
  ): { status: "accepted" | "updated" } {
    this.assertId(id);
    this.assertSpan(chargeAt, drawAt);
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be an integer >= 1");
    }
    const status = this.registry.register({ id, payload, chargeAt, drawAt, cost });
    return { status };
  }

  recharge(id: string, chargeAt: number, drawAt: number): boolean {
    this.assertId(id);
    this.assertSpan(chargeAt, drawAt);
    return this.registry.respawn(id, chargeAt, drawAt);
  }

  rake(id: string): boolean {
    this.assertId(id);
    const removed = this.registry.remove(id);
    if (!removed) return false;
    this.gate.forget(id);
    return true;
  }

  baffle(id: string): boolean {
    this.assertKnown(id);
    this.gate.set(id);
    return true;
  }

  unbaffle(id: string): boolean {
    this.assertKnown(id);
    this.gate.clear(id);
    return true;
  }

  isBaffled(id: string): boolean {
    this.assertKnown(id);
    return this.gate.isBaffled(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  soda(): number {
    return this.ledger.soda();
  }

  peek(): RackSnapshot | null {
    const [head] = this.candidates(this.clock.now());
    return head ? snapshot(head) : null;
  }

  pop(): RackSnapshot | null {
    for (const rack of this.candidates(this.clock.now())) {
      if (this.ledger.canAfford(rack.cost)) {
        this.ledger.spend(rack.cost);
        this.registry.remove(rack.id);
        this.gate.forget(rack.id);
        return snapshot(rack);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((rack) => rack.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: RackSnapshot[] = [];
    for (const rack of this.candidates(now)) {
      if (this.ledger.canAfford(rack.cost)) {
        this.ledger.spend(rack.cost);
        this.registry.remove(rack.id);
        this.gate.forget(rack.id);
        drawn.push(snapshot(rack));
      }
    }
    const washed: string[] = [];
    for (const id of this.registry.ids()) {
      const rack = this.registry.get(id);
      if (rack && now >= rack.drawAt && !this.gate.isBaffled(id)) {
        this.registry.remove(id);
        washed.push(id);
      }
    }
    return { drawn, washed };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { chargeAt: number; drawAt: number } | null {
    this.assertId(id);
    const rack = this.registry.get(id);
    return rack ? { chargeAt: rack.chargeAt, drawAt: rack.drawAt } : null;
  }

  costOf(id: string): number | null {
    this.assertId(id);
    const rack = this.registry.get(id);
    return rack ? rack.cost : null;
  }

  private candidates(now: number): Rack[] {
    const ripe: Array<{ rack: Rack; seq: number }> = [];
    let seq = 0;
    for (const id of this.registry.ids()) {
      const rack = this.registry.get(id);
      if (!rack) continue;
      if (
        rack.chargeAt <= now &&
        now < rack.drawAt &&
        !this.gate.isBaffled(id)
      ) {
        ripe.push({ rack, seq });
      }
      seq += 1;
    }
    ripe.sort(
      (a, b) =>
        a.rack.drawAt - b.rack.drawAt ||
        b.rack.cost - a.rack.cost ||
        a.seq - b.seq,
    );
    return ripe.map((entry) => entry.rack);
  }

  private assertId(id: unknown): asserts id is string {
    if (!isValidId(id)) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private assertSpan(chargeAt: unknown, drawAt: unknown): void {
    if (!isValidSpan(chargeAt, drawAt)) {
      throw new InvalidSpanError(
        "chargeAt/drawAt must be integers >= 0 with drawAt > chargeAt",
      );
    }
  }

  private assertKnown(id: unknown): asserts id is string {
    this.assertId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown rack id: ${id}`);
    }
  }
}

function snapshot(rack: Rack): RackSnapshot {
  return {
    id: rack.id,
    payload: rack.payload,
    chargeAt: rack.chargeAt,
    drawAt: rack.drawAt,
    cost: rack.cost,
  };
}
