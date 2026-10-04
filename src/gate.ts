import { VirtualClock } from "./clock.js";
import {
  FenceError,
  InvalidConfigError,
  InvalidWaitError,
  UnknownWaitError,
} from "./errors.js";

export type WaitStatus = "open" | "done" | "timedOut" | "cancelled";

export interface WaitResult {
  waitId: number;
  status: "done" | "timedOut" | "cancelled";
  arrived: string[];
  missing: string[];
}

export interface OpenOptions {
  timeoutMs?: number;
}

export interface OpenHandle {
  waitId: number;
  gen: number;
  deadline: number;
}

export interface WaitGateConfig {
  clock: VirtualClock;
  defaultTimeoutMs: number;
  maxParties?: number;
}

interface WaitRecord {
  waitId: number;
  parties: string[];
  arrived: Set<string>;
  status: WaitStatus;
  deadline: number;
}

const GEN = 1;

export class WaitGate {
  private readonly clock: VirtualClock;
  private readonly defaultTimeoutMs: number;
  private readonly maxParties: number;
  private nextWaitId = 1;
  private readonly waits = new Map<number, WaitRecord>();
  private readonly results: WaitResult[] = [];

  constructor(config: WaitGateConfig) {
    if (!config || !(config.clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    if (
      !Number.isFinite(config.defaultTimeoutMs) ||
      config.defaultTimeoutMs < 1
    ) {
      throw new InvalidConfigError("defaultTimeoutMs must be >= 1");
    }
    const maxParties = config.maxParties ?? 32;
    if (!Number.isInteger(maxParties) || maxParties < 1) {
      throw new InvalidConfigError("maxParties must be an integer >= 1");
    }
    this.clock = config.clock;
    this.defaultTimeoutMs = config.defaultTimeoutMs;
    this.maxParties = maxParties;
  }

  open(parties: string[], opts: OpenOptions = {}): OpenHandle {
    if (!Array.isArray(parties) || parties.length === 0) {
      throw new InvalidWaitError("parties must be a non-empty array");
    }
    for (const party of parties) {
      if (typeof party !== "string" || party.length === 0) {
        throw new InvalidWaitError("party names must be non-empty strings");
      }
    }
    const deduped = [...new Set(parties)].sort();
    if (deduped.length > this.maxParties) {
      throw new InvalidWaitError("too many parties");
    }
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
      throw new InvalidWaitError("timeoutMs must be >= 1");
    }
    const waitId = this.nextWaitId++;
    const deadline = this.clock.now() + timeoutMs;
    this.waits.set(waitId, {
      waitId,
      parties: deduped,
      arrived: new Set(),
      status: "open",
      deadline,
    });
    return { waitId, gen: GEN, deadline };
  }

  arrive(waitId: number, gen: number, party: string): "ok" | "duplicate" | "late" {
    const record = this.lookup(waitId, gen);
    if (!record.parties.includes(party)) {
      throw new InvalidWaitError(`unknown party: ${party}`);
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
    for (const record of [...this.waits.values()].sort(
      (a, b) => a.waitId - b.waitId,
    )) {
      if (record.status === "open" && now >= record.deadline) {
        record.status = "timedOut";
        this.emit(record);
        timedOut.push(record.waitId);
      }
    }
    return { timedOut };
  }

  poll(maxn?: number): WaitResult[] {
    if (maxn !== undefined && (!Number.isInteger(maxn) || maxn < 1)) {
      throw new InvalidWaitError("maxn must be an integer >= 1");
    }
    const count = maxn ?? this.results.length;
    return this.results.splice(0, count);
  }

  status(waitId: number): WaitStatus {
    return this.get(waitId).status;
  }

  arrivedOf(waitId: number): string[] {
    const record = this.get(waitId);
    return record.parties.filter((party) => record.arrived.has(party));
  }

  missingOf(waitId: number): string[] {
    const record = this.get(waitId);
    return record.parties.filter((party) => !record.arrived.has(party));
  }

  deadlineOf(waitId: number): number {
    return this.get(waitId).deadline;
  }

  private get(waitId: number): WaitRecord {
    const record = this.waits.get(waitId);
    if (!record) {
      throw new UnknownWaitError(`unknown waitId: ${waitId}`);
    }
    return record;
  }

  private lookup(waitId: number, gen: number): WaitRecord {
    const record = this.get(waitId);
    if (gen !== GEN) {
      throw new FenceError(`stale gen: expected ${GEN}, got ${gen}`);
    }
    return record;
  }

  private emit(record: WaitRecord): void {
    this.results.push({
      waitId: record.waitId,
      status: record.status as WaitResult["status"],
      arrived: this.arrivedOf(record.waitId),
      missing: this.missingOf(record.waitId),
    });
  }
}
