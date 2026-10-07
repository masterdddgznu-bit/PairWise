import { VirtualClock } from "./clock.js";
import {
  InvalidConfigError,
  InvalidFluxError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";
import { FluxLedger } from "./ledger.js";
import { Batch, BatchRegistry } from "./registry.js";

export interface KettleOptions {
  clock: VirtualClock;
  maxBatches?: number;
  initialFlux?: number;
}

export interface BatchView {
  id: string;
  payload: unknown;
  meltAt: number;
  pourAt: number;
  flux: number;
}

export interface DriveResult {
  drawn: BatchView[];
  spent: string[];
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(meltAt: number, pourAt: number): void {
  if (
    !Number.isInteger(meltAt) ||
    !Number.isInteger(pourAt) ||
    meltAt < 0 ||
    pourAt < 0 ||
    pourAt <= meltAt
  ) {
    throw new InvalidSpanError("span requires finite integers 0 <= meltAt < pourAt");
  }
}

function viewOf(batch: Batch): BatchView {
  return {
    id: batch.id,
    payload: batch.payload,
    meltAt: batch.meltAt,
    pourAt: batch.pourAt,
    flux: batch.flux,
  };
}

export class PitchKettle {
  private readonly clock: VirtualClock;
  private readonly registry: BatchRegistry;
  private readonly ledger: FluxLedger;

  constructor(options: KettleOptions) {
    const maxBatches = options.maxBatches ?? 5;
    const initialFlux = options.initialFlux ?? 0;
    if (!Number.isInteger(maxBatches) || maxBatches < 1) {
      throw new InvalidConfigError("maxBatches must be an integer >= 1");
    }
    if (!Number.isInteger(initialFlux) || initialFlux < 0) {
      throw new InvalidConfigError("initialFlux must be an integer >= 0");
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
    assertId(id);
    assertSpan(meltAt, pourAt);
    if (!Number.isInteger(flux) || flux < 1) {
      throw new InvalidFluxError("flux must be an integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.meltAt = meltAt;
      existing.pourAt = pourAt;
      existing.flux = flux;
      return { status: "updated" };
    }
    this.registry.add(id, payload, meltAt, pourAt, flux);
    return { status: "accepted" };
  }

  remelt(id: string, meltAt: number, pourAt: number): boolean {
    assertId(id);
    assertSpan(meltAt, pourAt);
    const batch = this.registry.get(id);
    if (!batch) {
      return false;
    }
    batch.meltAt = meltAt;
    batch.pourAt = pourAt;
    batch.lidded = true;
    return true;
  }

  drop(id: string): boolean {
    assertId(id);
    return this.registry.remove(id);
  }

  lid(id: string): boolean {
    assertId(id);
    this.registry.require(id).lidded = true;
    return true;
  }

  unlid(id: string): boolean {
    assertId(id);
    this.registry.require(id).lidded = false;
    return true;
  }

  isLidded(id: string): boolean {
    assertId(id);
    return this.registry.require(id).lidded;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  flux(): number {
    return this.ledger.available();
  }

  peek(): BatchView | null {
    const [head] = this.candidates();
    return head ? viewOf(head) : null;
  }

  pop(): BatchView | null {
    const target = this.candidates().find((batch) =>
      this.ledger.canAfford(batch.flux),
    );
    if (!target) {
      return null;
    }
    this.ledger.spend(target.flux);
    this.registry.remove(target.id);
    return viewOf(target);
  }

  ripeIds(): string[] {
    return this.candidates().map((batch) => batch.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const batch of this.registry.inFirstLoadOrder()) {
      if (!batch.lidded && now >= batch.pourAt) {
        this.registry.remove(batch.id);
        spent.push(batch.id);
      }
    }
    const drawn: BatchView[] = [];
    for (;;) {
      const target = this.candidates(now).find((batch) =>
        this.ledger.canAfford(batch.flux),
      );
      if (!target) {
        break;
      }
      this.ledger.spend(target.flux);
      this.registry.remove(target.id);
      drawn.push(viewOf(target));
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.inFirstLoadOrder().map((batch) => batch.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { meltAt: number; pourAt: number } | null {
    assertId(id);
    const batch = this.registry.get(id);
    return batch ? { meltAt: batch.meltAt, pourAt: batch.pourAt } : null;
  }

  fluxOf(id: string): number | null {
    assertId(id);
    return this.registry.get(id)?.flux ?? null;
  }

  private candidates(now = this.clock.now()): Batch[] {
    return this.registry
      .inFirstLoadOrder()
      .filter(
        (batch) => !batch.lidded && batch.meltAt <= now && now < batch.pourAt,
      )
      .sort((a, b) => b.pourAt - a.pourAt || b.flux - a.flux || a.seq - b.seq);
  }
}
