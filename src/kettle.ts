import { VirtualClock } from "./clock.js";
import { InvalidConfigError, UnknownIdError } from "./errors.js";
import { FluxLedger } from "./flux.js";
import {
  assertValidFlux,
  assertValidId,
  assertValidSpan,
  Batch,
  BatchRegistry,
  BatchSnapshot,
  snapshotOf,
} from "./registry.js";

export interface PitchKettleOptions {
  clock: VirtualClock;
  maxBatches?: number;
  initialFlux?: number;
}

function isLive(batch: Batch, now: number): boolean {
  return batch.meltAt <= now && now < batch.pourAt;
}

function isSpent(batch: Batch, now: number): boolean {
  return now >= batch.pourAt;
}

/** Ranking: later pourAt first, then higher flux, then first-load seq. */
function byRank(a: Batch, b: Batch): number {
  if (a.pourAt !== b.pourAt) return b.pourAt - a.pourAt;
  if (a.flux !== b.flux) return b.flux - a.flux;
  return a.seq - b.seq;
}

export class PitchKettle {
  private readonly clock: VirtualClock;
  private readonly registry: BatchRegistry;
  private readonly ledger: FluxLedger;

  constructor(options: PitchKettleOptions) {
    const maxBatches = options?.maxBatches ?? 5;
    const initialFlux = options?.initialFlux ?? 0;
    if (
      !(options?.clock instanceof VirtualClock) ||
      !Number.isInteger(maxBatches) ||
      maxBatches < 1 ||
      !Number.isInteger(initialFlux) ||
      initialFlux < 0
    ) {
      throw new InvalidConfigError("invalid kettle configuration");
    }
    this.clock = options.clock;
    this.registry = new BatchRegistry(maxBatches);
    this.ledger = new FluxLedger(initialFlux);
  }

  charge(
    id: string,
    payload: unknown,
    meltAt: number,
    pourAt: number,
    flux = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(meltAt, pourAt);
    assertValidFlux(flux);
    return { status: this.registry.charge(id, payload, meltAt, pourAt, flux) };
  }

  remelt(id: string, meltAt: number, pourAt: number): boolean {
    assertValidId(id);
    assertValidSpan(meltAt, pourAt);
    const batch = this.registry.get(id);
    if (!batch) return false;
    batch.meltAt = meltAt;
    batch.pourAt = pourAt;
    batch.lidded = true;
    return true;
  }

  drop(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  lid(id: string): boolean {
    assertValidId(id);
    const batch = this.registry.get(id);
    if (!batch) throw new UnknownIdError(`unknown id: ${id}`);
    batch.lidded = true;
    return true;
  }

  unlid(id: string): boolean {
    assertValidId(id);
    const batch = this.registry.get(id);
    if (!batch) throw new UnknownIdError(`unknown id: ${id}`);
    batch.lidded = false;
    return true;
  }

  isLidded(id: string): boolean {
    assertValidId(id);
    const batch = this.registry.get(id);
    if (!batch) throw new UnknownIdError(`unknown id: ${id}`);
    return batch.lidded;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  flux(): number {
    return this.ledger.available();
  }

  /** Unlidded batches inside their cook window, in draw rank order. */
  private candidates(): Batch[] {
    const now = this.clock.now();
    return this.registry
      .all()
      .filter((batch) => !batch.lidded && isLive(batch, now))
      .sort(byRank);
  }

  peek(): BatchSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): BatchSnapshot | null {
    const target = this.candidates().find((batch) => this.ledger.canAfford(batch.flux));
    if (!target) return null;
    this.ledger.spend(target.flux);
    this.registry.remove(target.id);
    return snapshotOf(target);
  }

  ripeIds(): string[] {
    return this.candidates().map((batch) => batch.id);
  }

  drive(): { drawn: BatchSnapshot[]; spent: string[] } {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const batch of this.registry.all()) {
      if (!batch.lidded && isSpent(batch, now)) {
        spent.push(batch.id);
        this.registry.remove(batch.id);
      }
    }
    const drawn: BatchSnapshot[] = [];
    for (;;) {
      const next = this.pop();
      if (!next) break;
      drawn.push(next);
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.all().map((batch) => batch.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { meltAt: number; pourAt: number } | null {
    assertValidId(id);
    const batch = this.registry.get(id);
    return batch ? { meltAt: batch.meltAt, pourAt: batch.pourAt } : null;
  }

  fluxOf(id: string): number | null {
    assertValidId(id);
    const batch = this.registry.get(id);
    return batch ? batch.flux : null;
  }
}
