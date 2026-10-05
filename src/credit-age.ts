import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  UnknownLienError,
} from "./errors.js";
import { Lien, LienBook } from "./liens.js";
import { Tranche, TrancheLedger } from "./tranches.js";

export interface CreditAgeOptions {
  clock: VirtualClock;
  trancheTtlMs: number;
  lienTtlMs: number;
  maxBalance: number;
}

export interface GrantResult {
  status: "accepted";
}

export interface HoldResult {
  lienId: number;
}

export interface DriveResult {
  expiredTrancheAmount: number;
  expiredTrancheCount: number;
  expiredLiens: number[];
  forcedReleased: number;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 1;
}

export class CreditAge {
  private readonly clock: VirtualClock;
  private readonly trancheTtlMs: number;
  private readonly lienTtlMs: number;
  private readonly maxBalance: number;
  private readonly ledger = new TrancheLedger();
  private readonly lienBook = new LienBook();

  constructor(options: CreditAgeOptions) {
    if (
      !isPositiveInteger(options.trancheTtlMs) ||
      !isPositiveInteger(options.lienTtlMs) ||
      !isPositiveInteger(options.maxBalance)
    ) {
      throw new InvalidConfigError(
        "trancheTtlMs, lienTtlMs and maxBalance must be integers >= 1",
      );
    }
    this.clock = options.clock;
    this.trancheTtlMs = options.trancheTtlMs;
    this.lienTtlMs = options.lienTtlMs;
    this.maxBalance = options.maxBalance;
  }

  balance(): number {
    return this.ledger.balance(this.clock.now());
  }

  held(): number {
    return this.lienBook.held(this.clock.now());
  }

  available(): number {
    return Math.max(0, this.balance() - this.held());
  }

  grant(amount: number): GrantResult {
    this.assertAmount(amount);
    this.ledger.sweepExpired(this.clock.now());
    if (this.balance() + amount > this.maxBalance) {
      throw new CapacityError("grant would exceed maxBalance");
    }
    this.ledger.append(amount, this.clock.now() + this.trancheTtlMs);
    return { status: "accepted" };
  }

  hold(amount: number): HoldResult {
    this.assertAmount(amount);
    this.ledger.sweepExpired(this.clock.now());
    this.lienBook.sweepExpired(this.clock.now());
    if (this.available() < amount) {
      throw new CapacityError("hold exceeds available credit");
    }
    const lienId = this.lienBook.add(amount, this.clock.now() + this.lienTtlMs);
    return { lienId };
  }

  release(lienId: number): boolean {
    if (!this.lienBook.wasIssued(lienId)) {
      throw new UnknownLienError(`unknown lienId: ${lienId}`);
    }
    return this.lienBook.remove(lienId);
  }

  spend(amount: number): boolean {
    this.assertAmount(amount);
    this.ledger.sweepExpired(this.clock.now());
    this.lienBook.sweepExpired(this.clock.now());
    if (this.balance() < amount) {
      return false;
    }
    let remaining = amount;
    const fromLiens = this.lienBook.reduce(remaining);
    this.ledger.consume(fromLiens);
    remaining -= fromLiens;
    if (remaining > 0) {
      this.ledger.consume(remaining);
    }
    return true;
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const swept = this.ledger.sweepExpired(now);
    const expiredLiens = this.lienBook.sweepExpired(now);
    let forcedReleased = 0;
    const excess = this.held() - this.balance();
    if (excess > 0) {
      forcedReleased = this.lienBook.reduce(excess);
    }
    return {
      expiredTrancheAmount: swept.amount,
      expiredTrancheCount: swept.count,
      expiredLiens,
      forcedReleased,
    };
  }

  tranches(): Tranche[] {
    return this.ledger.list();
  }

  liens(): Lien[] {
    return this.lienBook.list();
  }

  size(): number {
    return this.ledger.size();
  }

  private assertAmount(amount: number): void {
    if (!isPositiveInteger(amount)) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
  }
}
