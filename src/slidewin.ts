import type { VirtualClock } from "./clock.js";
import { DebtLedger } from "./debt.js";
import {
  CapacityError,
  DebtBlockedError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
  QuarantineError,
} from "./errors.js";
import { QuarantineSet } from "./quarantine.js";
import { EventRegistry } from "./registry.js";

export interface SlideWinOptions {
  clock: VirtualClock;
  windowMs: number;
  maxEvents: number;
  debtHealPerDrive?: number;
}

export interface AdmitResult {
  status: "accepted";
}

export interface DriveResult {
  purged: string[];
  healed: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export class SlideWin {
  private readonly clock: VirtualClock;
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private readonly debtHealPerDrive: number;
  private readonly registry = new EventRegistry();
  private readonly ledger = new DebtLedger();
  private readonly quarantined = new QuarantineSet();

  constructor(options: SlideWinOptions) {
    const { clock, windowMs, maxEvents, debtHealPerDrive = 1 } = options;
    if (
      clock == null ||
      !isPositiveInt(windowMs) ||
      !isPositiveInt(maxEvents) ||
      !isPositiveInt(debtHealPerDrive)
    ) {
      throw new InvalidConfigError(
        "windowMs, maxEvents and debtHealPerDrive must be integers >= 1, and a clock is required",
      );
    }
    this.clock = clock;
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
    this.debtHealPerDrive = debtHealPerDrive;
  }

  private inWindow(ts: number): boolean {
    return this.clock.now() - ts < this.windowMs;
  }

  private sweep(): string[] {
    return this.registry.purgeWhere((ts) => !this.inWindow(ts));
  }

  admit(id: string): AdmitResult {
    assertValidId(id);
    if (this.quarantined.has(id)) {
      throw new QuarantineError(`id "${id}" is quarantined`);
    }
    if (this.ledger.value() > 0) {
      throw new DebtBlockedError(`debt ${this.ledger.value()} blocks admit`);
    }
    this.sweep();
    if (this.registry.has(id)) {
      throw new DuplicateIdError(`id "${id}" already admitted`);
    }
    const occupants = this.registry.countWhere(
      (rid, ts) => this.inWindow(ts) && !this.quarantined.has(rid),
    );
    if (occupants >= this.maxEvents) {
      this.ledger.incur(1);
      throw new CapacityError(`window capacity ${this.maxEvents} reached`);
    }
    this.registry.add(id, this.clock.now());
    return { status: "accepted" };
  }

  cancel(id: string): boolean {
    assertValidId(id);
    this.sweep();
    return this.registry.remove(id);
  }

  quarantine(id: string): void {
    assertValidId(id);
    this.quarantined.add(id);
  }

  clearQuarantine(id: string): boolean {
    assertValidId(id);
    return this.quarantined.remove(id);
  }

  drive(): DriveResult {
    const purged = this.sweep();
    const healed = this.ledger.heal(this.debtHealPerDrive);
    return { purged, healed };
  }

  count(): number {
    return this.registry.countWhere(
      (id, ts) => this.inWindow(ts) && !this.quarantined.has(id),
    );
  }

  size(): number {
    return this.registry.size();
  }

  debt(): number {
    return this.ledger.value();
  }

  ids(): string[] {
    return this.registry.ids();
  }

  inWindowIds(): string[] {
    return this.registry.idsWhere(
      (id, ts) => this.inWindow(ts) && !this.quarantined.has(id),
    );
  }

  admittedAt(id: string): number | null {
    assertValidId(id);
    const ts = this.registry.get(id);
    return ts === undefined ? null : ts;
  }

  isQuarantined(id: string): boolean {
    assertValidId(id);
    return this.quarantined.has(id);
  }
}
