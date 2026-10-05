import { VirtualClock } from "./clock.js";
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
import { WindowRegistry } from "./window.js";

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

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

function assertValidId(id: string): void {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export class SlideWin {
  private readonly clock: VirtualClock;
  private readonly windowMs: number;
  private readonly maxEvents: number;
  private readonly debtHealPerDrive: number;
  private readonly registry = new WindowRegistry();
  private readonly ledger = new DebtLedger();
  private readonly quarantined = new QuarantineSet();

  constructor(options: SlideWinOptions) {
    const { clock, windowMs, maxEvents, debtHealPerDrive = 1 } = options;
    if (!isPositiveInt(windowMs) || !isPositiveInt(maxEvents) || !isPositiveInt(debtHealPerDrive)) {
      throw new InvalidConfigError(
        "windowMs, maxEvents and debtHealPerDrive must be integers >= 1",
      );
    }
    this.clock = clock;
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
    this.debtHealPerDrive = debtHealPerDrive;
  }

  admit(id: string): AdmitResult {
    assertValidId(id);
    if (this.quarantined.has(id)) {
      throw new QuarantineError(`id "${id}" is quarantined`);
    }
    if (this.ledger.current() > 0) {
      throw new DebtBlockedError("outstanding debt blocks new admits");
    }
    this.registry.purgeStale(this.clock.now(), this.windowMs);
    if (this.registry.has(id)) {
      throw new DuplicateIdError(`id "${id}" is already admitted`);
    }
    const now = this.clock.now();
    const active = this.registry
      .inWindow(now, this.windowMs)
      .filter((entry) => !this.quarantined.has(entry.id)).length;
    if (active >= this.maxEvents) {
      this.ledger.penalize(1);
      throw new CapacityError("window is at capacity");
    }
    this.registry.add(id, now);
    return { status: "accepted" };
  }

  cancel(id: string): boolean {
    assertValidId(id);
    this.registry.purgeStale(this.clock.now(), this.windowMs);
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
    const purged = this.registry.purgeStale(this.clock.now(), this.windowMs);
    const healed = this.ledger.heal(this.debtHealPerDrive);
    return { purged, healed };
  }

  count(): number {
    const now = this.clock.now();
    return this.registry
      .inWindow(now, this.windowMs)
      .filter((entry) => !this.quarantined.has(entry.id)).length;
  }

  size(): number {
    return this.registry.size();
  }

  debt(): number {
    return this.ledger.current();
  }

  ids(): string[] {
    return this.registry.ids();
  }

  inWindowIds(): string[] {
    const now = this.clock.now();
    return this.registry
      .inWindow(now, this.windowMs)
      .filter((entry) => !this.quarantined.has(entry.id))
      .map((entry) => entry.id);
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
