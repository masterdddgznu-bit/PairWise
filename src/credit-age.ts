import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  UnknownLienError,
} from "./errors.js";
import { TrancheLedger } from "./ledger.js";
import { LienBook } from "./liens.js";

export interface CreditAgeOptions {
  clock: VirtualClock;
  trancheTtlMs: number;
  lienTtlMs: number;
  maxBalance: number;
}

export interface DriveReport {
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
    const { clock, trancheTtlMs, lienTtlMs, maxBalance } = options;
    if (
      !isPositiveInteger(trancheTtlMs) ||
      !isPositiveInteger(lienTtlMs) ||
      !isPositiveInteger(maxBalance)
    ) {
      throw new InvalidConfigError(
        "trancheTtlMs, lienTtlMs and maxBalance must be integers >= 1",
      );
    }
    this.clock = clock;
    this.trancheTtlMs = trancheTtlMs;
    this.lienTtlMs = lienTtlMs;
    this.maxBalance = maxBalance;
  }

  balance(): number {
    return this.ledger.liveBalance(this.clock.now());
  }

  held(): number {
    return this.lienBook.liveHeld(this.clock.now());
  }

  available(): number {
    return Math.max(0, this.balance() - this.held());
  }

  tranches(): Array<{ amount: number; deadline: number }> {
    return this.ledger.all();
  }

  liens(): Array<{ lienId: number; remaining: number; deadline: number }> {
    return this.lienBook.all();
  }

  size(): number {
    return this.ledger.size();
  }

  grant(amount: number): { status: "accepted" } {
    this.assertAmount(amount);
    this.ledger.sweepExpired(this.clock.now());
    if (this.balance() + amount > this.maxBalance) {
      throw new CapacityError("grant exceeds maxBalance");
    }
    this.ledger.append(amount, this.clock.now() + this.trancheTtlMs);
    return { status: "accepted" };
  }

  hold(amount: number): { lienId: number } {
    this.assertAmount(amount);
    this.ledger.sweepExpired(this.clock.now());
    this.lienBook.sweepExpired(this.clock.now());
    if (this.available() < amount) {
      throw new CapacityError("hold exceeds available credit");
    }
    const lienId = this.lienBook.create(
      amount,
      this.clock.now() + this.lienTtlMs,
    );
    return { lienId };
  }

  release(lienId: number): boolean {
    if (!this.lienBook.wasIssued(lienId)) {
      throw new UnknownLienError(`unknown lienId: ${String(lienId)}`);
    }
    return this.lienBook.remove(lienId);
  }

  spend(amount: number): boolean {
    this.assertAmount(amount);
    this.ledger.sweepExpired(this.clock.now());
    this.lienBook.sweepExpired(this.clock.now());
    if (this.balance() < amount) return false;
    const fromLiens = this.lienBook.consumeOldest(amount);
    this.ledger.deduct(fromLiens);
    const rest = amount - fromLiens;
    if (rest > 0) this.ledger.deduct(rest);
    return true;
  }

  drive(): DriveReport {
    const now = this.clock.now();
    const swept = this.ledger.sweepExpired(now);
    const expiredLiens = this.lienBook.sweepExpired(now);
    let forcedReleased = 0;
    const excess = this.held() - this.balance();
    if (excess > 0) {
      forcedReleased = this.lienBook.forceReduce(excess);
    }
    return {
      expiredTrancheAmount: swept.amount,
      expiredTrancheCount: swept.count,
      expiredLiens,
      forcedReleased,
    };
  }

  private assertAmount(amount: number): void {
    if (!isPositiveInteger(amount)) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
  }
}
