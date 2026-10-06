import { InvalidConfigError } from "./errors.js";
import type { VirtualClock } from "./clock.js";
import { FuelLedger } from "./fuel.js";
import {
  PocketRegistry,
  snapshotOf,
  validateId,
  type Pocket,
  type PocketSnapshot,
} from "./registry.js";

export interface OastKilnOptions {
  clock: VirtualClock;
  maxPockets?: number;
  initialFuel?: number;
}

export interface DriveResult {
  taken: PocketSnapshot[];
  flushed: string[];
}

function isRipe(pocket: Pocket, now: number): boolean {
  return pocket.loadAt <= now && now < pocket.unloadAt;
}

function isOverdried(pocket: Pocket, now: number): boolean {
  return now >= pocket.unloadAt;
}

function compareCandidates(a: Pocket, b: Pocket): number {
  if (a.unloadAt !== b.unloadAt) return a.unloadAt - b.unloadAt;
  if (a.cost !== b.cost) return a.cost - b.cost;
  return a.seq - b.seq;
}

export class OastKiln {
  private readonly clock: VirtualClock;
  private readonly registry: PocketRegistry;
  private readonly ledger: FuelLedger;

  constructor(options: OastKilnOptions) {
    const maxPockets = options.maxPockets ?? 5;
    const initialFuel = options.initialFuel ?? 0;
    if (!Number.isInteger(maxPockets) || maxPockets < 1) {
      throw new InvalidConfigError("maxPockets must be an integer >= 1");
    }
    if (!Number.isInteger(initialFuel) || initialFuel < 0) {
      throw new InvalidConfigError("initialFuel must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new PocketRegistry(maxPockets);
    this.ledger = new FuelLedger(initialFuel);
  }

  load(
    id: string,
    payload: unknown,
    loadAt: number,
    unloadAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    return { status: this.registry.load(id, payload, loadAt, unloadAt, cost) };
  }

  reload(id: string, loadAt: number, unloadAt: number): boolean {
    return this.registry.reload(id, loadAt, unloadAt);
  }

  dump(id: string): boolean {
    return this.registry.dump(id);
  }

  seal(id: string): boolean {
    this.registry.get(id).sealed = true;
    return true;
  }

  vent(id: string): boolean {
    this.registry.get(id).sealed = false;
    return true;
  }

  isSealed(id: string): boolean {
    return this.registry.get(id).sealed;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  fuel(): number {
    return this.ledger.available();
  }

  peek(): PocketSnapshot | null {
    const head = this.candidates(this.clock.now())[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): PocketSnapshot | null {
    for (const pocket of this.candidates(this.clock.now())) {
      if (this.ledger.canAfford(pocket.cost)) {
        this.ledger.spend(pocket.cost);
        this.registry.remove(pocket.id);
        return snapshotOf(pocket);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((pocket) => pocket.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const taken: PocketSnapshot[] = [];
    for (const pocket of this.candidates(now)) {
      if (this.ledger.canAfford(pocket.cost)) {
        this.ledger.spend(pocket.cost);
        this.registry.remove(pocket.id);
        taken.push(snapshotOf(pocket));
      }
    }
    const flushed: string[] = [];
    for (const pocket of this.registry.inFirstLoadOrder()) {
      if (!pocket.sealed && isOverdried(pocket, now)) {
        this.registry.remove(pocket.id);
        flushed.push(pocket.id);
      }
    }
    return { taken, flushed };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { loadAt: number; unloadAt: number } | null {
    validateId(id);
    const pocket = this.registry.find(id);
    return pocket
      ? { loadAt: pocket.loadAt, unloadAt: pocket.unloadAt }
      : null;
  }

  costOf(id: string): number | null {
    validateId(id);
    return this.registry.find(id)?.cost ?? null;
  }

  private candidates(now: number): Pocket[] {
    return this.registry
      .inFirstLoadOrder()
      .filter((pocket) => !pocket.sealed && isRipe(pocket, now))
      .sort(compareCandidates);
  }
}
