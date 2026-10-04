import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidWaitError,
  UnknownWaitError,
} from "./errors.js";

export type WaitStatus = "open" | "done" | "timedOut" | "cancelled";

export type WaitResult = {
  waitId: number;
  status: "done" | "timedOut" | "cancelled";
  arrived: string[];
  missing: string[];
};

export type OpenOptions = {
  timeoutMs?: number;
};

export type OpenHandle = {
  waitId: number;
  gen: number;
  deadline: number;
};

export type WaitGateConfig = {
  clock: VirtualClock;
  defaultTimeoutMs: number;
  maxParties?: number;
};

type WaitRecord = {
  waitId: number;
  status: WaitStatus;
  parties: string[];
  arrived: Set<string>;
  deadline: number;
};

const GEN = 1;

export class WaitGate {
  private readonly clock: VirtualClock;
  private readonly defaultTimeoutMs: number;
  private readonly maxParties: number;
  private nextWaitId = 1;
  private readonly waits = new Map<number, WaitRecord>();
  private readonly results: WaitResult[] = [];

  constructor(config: WaitGateConfig) {
    if (
      !config ||
      !(config.clock instanceof VirtualClock) ||
      !Number.isFinite(config.defaultTimeoutMs) ||
      config.defaultTimeoutMs < 1
    ) {
      throw new InvalidConfigError(
        "WaitGate: clock and defaultTimeoutMs >= 1 are required",
      );
    }
    const maxParties = config.maxParties ?? 32;
    if (!Number.isInteger(maxParties) || maxParties < 1) {
      throw new InvalidConfigError("WaitGate: maxParties must be >= 1");
    }
    this.clock = config.clock;
    this.defaultTimeoutMs = config.defaultTimeoutMs;
    this.maxParties = maxParties;
  }

  open(parties: string[], opts: OpenOptions = {}): OpenHandle {
    if (!Array.isArray(parties) || parties.length === 0) {
      throw new InvalidWaitError("open: parties must be a non-empty array");
    }
    for (const party of parties) {
      if (typeof party !== "string" || party.length === 0) {
        throw new InvalidWaitError("open: party names must be non-empty");
      }
    }
    const unique = [...new Set(parties)].sort();
    if (unique.length > this.maxParties) {
      throw new InvalidWaitError(
        `open: at most ${this.maxParties} distinct parties allowed`,
      );
    }
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new InvalidWaitError("open: timeoutMs must be >= 1");
    }
    const waitId = this.nextWaitId++;
    const deadline = this.clock.now() + timeoutMs;
    this.waits.set(waitId, {
      waitId,
      status: "open",
      parties: unique,
      arrived: new Set(),
      deadline,
    });
    return { waitId, gen: GEN, deadline };
  }

  arrive(
    waitId: number,
    gen: number,
    party: string,
  ): "ok" | "duplicate" | "late" {
    const record = this.lookup(waitId, gen);
    if (!record.parties.includes(party)) {
      throw new InvalidWaitError(`arrive: unknown party ${party}`);
    }
    if (record.status !== "open") {
      return "late";
    }
    if (record.arrived.has(party)) {
      return "duplicate";
    }
    record.arrived.add(party);
    if (record.arrived.size === record.parties.length) {
      record.status = "done";
      this.emit(record);
    }
    return "ok";
  }

  cancel(waitId: number, gen: number): boolean {
    const record = this.lookup(waitId, gen);
    if (record.status !== "open") {
      return false;
    }
    record.status = "cancelled";
    this.emit(record);
    return true;
  }

  drive(): { timedOut: number[] } {
    const now = this.clock.now();
    const timedOut: number[] = [];
    for (const record of this.waits.values()) {
      if (record.status === "open" && now >= record.deadline) {
        record.status = "timedOut";
        this.emit(record);
        timedOut.push(record.waitId);
      }
    }
    timedOut.sort((a, b) => a - b);
    return { timedOut };
  }

  poll(maxn?: number): WaitResult[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new InvalidWaitError("poll: maxn must be >= 1");
    }
    const count = maxn === undefined ? this.results.length : Math.min(maxn, this.results.length);
    return this.results.splice(0, count);
  }

  status(waitId: number): WaitStatus {
    return this.recordOf(waitId).status;
  }

  arrivedOf(waitId: number): string[] {
    const record = this.recordOf(waitId);
    return [...record.arrived].sort();
  }

  missingOf(waitId: number): string[] {
    const record = this.recordOf(waitId);
    return record.parties.filter((party) => !record.arrived.has(party));
  }

  deadlineOf(waitId: number): number {
    return this.recordOf(waitId).deadline;
  }

  private recordOf(waitId: number): WaitRecord {
    const record = this.waits.get(waitId);
    if (!record) {
      throw new UnknownWaitError(`unknown waitId ${waitId}`);
    }
    return record;
  }

  private lookup(waitId: number, gen: number): WaitRecord {
    const record = this.recordOf(waitId);
    if (gen !== GEN) {
      throw new FenceError(`gen mismatch: expected ${GEN}, got ${gen}`);
    }
    return record;
  }

  private emit(record: WaitRecord): void {
    if (record.status === "open") {
      return;
    }
    this.results.push({
      waitId: record.waitId,
      status: record.status,
      arrived: [...record.arrived].sort(),
      missing: record.parties.filter((party) => !record.arrived.has(party)),
    });
  }
}
