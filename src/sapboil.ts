import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  UnknownIdError,
} from "./errors.js";
import { WoodLedger } from "./ledger.js";
import { LidGate } from "./lids.js";
import {
  PanRegistry,
  assertValidId,
  snapshotOf,
  type Pan,
  type PanSnapshot,
} from "./registry.js";

export interface SapBoilOptions {
  clock: VirtualClock;
  maxPans?: number;
  initialWood?: number;
}

export class SapBoil {
  private readonly clock: VirtualClock;
  private readonly registry: PanRegistry;
  private readonly lids = new LidGate();
  private readonly ledger: WoodLedger;

  constructor(options: SapBoilOptions) {
    const { clock, maxPans = 7, initialWood = 0 } = options;
    if (
      !clock ||
      !Number.isInteger(maxPans) ||
      maxPans < 1 ||
      !Number.isInteger(initialWood) ||
      initialWood < 0
    ) {
      throw new InvalidConfigError(
        "clock required; maxPans integer >= 1; initialWood integer >= 0",
      );
    }
    this.clock = clock;
    this.registry = new PanRegistry(maxPans);
    this.ledger = new WoodLedger(initialWood);
  }

  charge(
    id: string,
    payload: unknown,
    chargeAt: number,
    drawAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    const status = this.registry.charge(id, payload, chargeAt, drawAt, cost);
    if (status === "accepted") {
      this.lids.lid(id);
    }
    return { status };
  }

  recharge(id: string, chargeAt: number, drawAt: number): boolean {
    return this.registry.recharge(id, chargeAt, drawAt);
  }

  dump(id: string): boolean {
    assertValidId(id);
    const removed = this.registry.remove(id);
    if (!removed) {
      return false;
    }
    this.lids.forget(id);
    return true;
  }

  lid(id: string): boolean {
    this.requireKnown(id);
    this.lids.lid(id);
    return true;
  }

  unlid(id: string): boolean {
    this.requireKnown(id);
    this.lids.unlid(id);
    return true;
  }

  isLidded(id: string): boolean {
    this.requireKnown(id);
    return this.lids.isLidded(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  wood(): number {
    return this.ledger.wood();
  }

  peek(): PanSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): PanSnapshot | null {
    const pan = this.candidates(this.clock.now()).find((p) =>
      this.ledger.canAfford(p.cost),
    );
    if (!pan) {
      return null;
    }
    this.registry.remove(pan.id);
    this.lids.forget(pan.id);
    this.ledger.spend(pan.cost);
    return snapshotOf(pan);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((p) => p.id);
  }

  drive(): { drawn: PanSnapshot[]; boiledOff: string[] } {
    const now = this.clock.now();
    const boiledOff: string[] = [];
    for (const pan of this.registry.values()) {
      if (this.registry.overboiled(pan, now) && !this.lids.isLidded(pan.id)) {
        boiledOff.push(pan.id);
      }
    }
    for (const id of boiledOff) {
      this.registry.remove(id);
      this.lids.forget(id);
    }
    const drawn: PanSnapshot[] = [];
    for (const pan of this.candidates(now)) {
      if (!this.ledger.canAfford(pan.cost)) {
        continue;
      }
      this.registry.remove(pan.id);
      this.lids.forget(pan.id);
      this.ledger.spend(pan.cost);
      drawn.push(snapshotOf(pan));
    }
    return { drawn, boiledOff };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { chargeAt: number; drawAt: number } | null {
    assertValidId(id);
    const pan = this.registry.get(id);
    return pan ? { chargeAt: pan.chargeAt, drawAt: pan.drawAt } : null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    const pan = this.registry.get(id);
    return pan ? pan.cost : null;
  }

  private candidates(now: number): Pan[] {
    const open: Pan[] = [];
    for (const pan of this.registry.values()) {
      if (this.registry.inWindow(pan, now) && !this.lids.isLidded(pan.id)) {
        open.push(pan);
      }
    }
    return this.registry.ranked(open);
  }

  private requireKnown(id: string): void {
    assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown pan id: ${id}`);
    }
  }
}
