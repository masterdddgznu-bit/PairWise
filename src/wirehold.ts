import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidAccountError,
  InvalidConfigError,
  InvalidWireError,
  UnknownWireError,
} from "./errors.js";

export type WireStatus = "open" | "committed" | "aborted" | "timedout";

export interface WireHoldOptions {
  clock: VirtualClock;
  holdTimeoutMs: number;
  maxOpenWiresPerAccount?: number;
}

export interface Balance {
  available: number;
  held: number;
  total: number;
}

interface Account {
  available: number;
  held: number;
  fenceCounter: number;
  openWireIds: Set<number>;
}

interface WireRecord {
  wireId: number;
  fromId: string;
  toId: string;
  amount: number;
  fence: number;
  deadline: number;
  status: WireStatus;
}

export class WireHold {
  private readonly clock: VirtualClock;
  private readonly holdTimeoutMs: number;
  private readonly maxOpenWiresPerAccount: number;
  private readonly accounts = new Map<string, Account>();
  private readonly wires = new Map<number, WireRecord>();
  private nextWireId = 1;

  constructor(options: WireHoldOptions) {
    const { clock, holdTimeoutMs } = options;
    const maxOpenWiresPerAccount = options.maxOpenWiresPerAccount ?? 8;
    if (!Number.isFinite(holdTimeoutMs) || holdTimeoutMs < 1) {
      throw new InvalidConfigError("holdTimeoutMs must be a finite number >= 1");
    }
    if (
      !Number.isFinite(maxOpenWiresPerAccount) ||
      maxOpenWiresPerAccount < 1
    ) {
      throw new InvalidConfigError(
        "maxOpenWiresPerAccount must be a finite number >= 1",
      );
    }
    this.clock = clock;
    this.holdTimeoutMs = holdTimeoutMs;
    this.maxOpenWiresPerAccount = maxOpenWiresPerAccount;
  }

  openAccount(accountId: string, balance: number): void {
    if (typeof accountId !== "string" || accountId.length === 0) {
      throw new InvalidAccountError("accountId must be a non-empty string");
    }
    if (!Number.isFinite(balance) || balance < 0) {
      throw new InvalidAccountError("balance must be a finite number >= 0");
    }
    if (this.accounts.has(accountId)) {
      throw new InvalidAccountError(`account already exists: ${accountId}`);
    }
    this.accounts.set(accountId, {
      available: balance,
      held: 0,
      fenceCounter: 0,
      openWireIds: new Set(),
    });
  }

  balanceOf(accountId: string): Balance {
    const account = this.requireAccount(accountId);
    return {
      available: account.available,
      held: account.held,
      total: account.available + account.held,
    };
  }

  wire(fromId: string, toId: string, amount: number): { wireId: number; fence: number } {
    const from = this.requireAccount(fromId);
    this.requireAccount(toId);
    if (fromId === toId) {
      throw new InvalidWireError("cannot wire to the same account");
    }
    if (!Number.isFinite(amount) || amount < 1) {
      throw new InvalidWireError("amount must be a finite number >= 1");
    }
    if (from.openWireIds.size >= this.maxOpenWiresPerAccount) {
      throw new InvalidWireError("too many open wires for payer");
    }
    if (from.available < amount) {
      throw new InvalidWireError("insufficient available funds");
    }

    from.available -= amount;
    from.held += amount;
    from.fenceCounter += 1;

    const record: WireRecord = {
      wireId: this.nextWireId++,
      fromId,
      toId,
      amount,
      fence: from.fenceCounter,
      deadline: this.clock.now() + this.holdTimeoutMs,
      status: "open",
    };
    this.wires.set(record.wireId, record);
    from.openWireIds.add(record.wireId);
    return { wireId: record.wireId, fence: record.fence };
  }

  commit(wireId: number, fence: number): boolean {
    const record = this.requireWire(wireId);
    if (record.status !== "open") {
      return false;
    }
    this.checkFence(record, fence);
    const from = this.accounts.get(record.fromId)!;
    const to = this.accounts.get(record.toId)!;
    from.held -= record.amount;
    to.available += record.amount;
    record.status = "committed";
    from.openWireIds.delete(wireId);
    return true;
  }

  abort(wireId: number, fence: number): boolean {
    const record = this.requireWire(wireId);
    if (record.status !== "open") {
      return false;
    }
    this.checkFence(record, fence);
    this.release(record);
    record.status = "aborted";
    return true;
  }

  drive(): { timedOut: number[] } {
    const now = this.clock.now();
    const timedOut: number[] = [];
    for (const record of this.wires.values()) {
      if (record.status === "open" && now >= record.deadline) {
        this.release(record);
        record.status = "timedout";
        timedOut.push(record.wireId);
      }
    }
    timedOut.sort((a, b) => a - b);
    return { timedOut };
  }

  statusOf(wireId: number): WireStatus {
    return this.requireWire(wireId).status;
  }

  openWiresOf(accountId: string): number[] {
    const account = this.requireAccount(accountId);
    return [...account.openWireIds].sort((a, b) => a - b);
  }

  fenceOf(wireId: number): number {
    return this.requireWire(wireId).fence;
  }

  private release(record: WireRecord): void {
    const from = this.accounts.get(record.fromId)!;
    from.held -= record.amount;
    from.available += record.amount;
    from.openWireIds.delete(record.wireId);
  }

  private checkFence(record: WireRecord, fence: number): void {
    if (record.fence !== fence) {
      throw new FenceError(
        `fence mismatch for wire ${record.wireId}: expected ${record.fence}, got ${fence}`,
      );
    }
  }

  private requireAccount(accountId: string): Account {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new InvalidAccountError(`unknown account: ${accountId}`);
    }
    return account;
  }

  private requireWire(wireId: number): WireRecord {
    const record = this.wires.get(wireId);
    if (!record) {
      throw new UnknownWireError(`unknown wire: ${wireId}`);
    }
    return record;
  }
}
