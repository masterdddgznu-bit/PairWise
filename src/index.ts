export class SealBagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SealBagError {}
export class InvalidKeyError extends SealBagError {}
export class CapacityError extends SealBagError {}
export class UnknownEpochError extends SealBagError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new SealBagError("advance requires a non-negative number of ms");
    }
    this.current += ms;
    return this.current;
  }
}

export interface ClockLike {
  now(): number;
}

export interface SealBagOptions {
  clock: ClockLike;
  idleMs: number;
  maxOpenKeys?: number;
}

export type EpochStatus = "open" | "sealed" | "drained";

export interface PutResult {
  epoch: number;
  status: "accepted" | "updated";
}

export interface TakeResult {
  epoch: number;
  key: string;
  payload: unknown;
}

interface EpochState {
  status: EpochStatus;
  order: string[];
  payloads: Map<string, unknown>;
  lastPutAt: number | null;
}

const DEFAULT_MAX_OPEN_KEYS = 16;

function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError("key must be a non-empty string");
  }
}

export class SealBag {
  private readonly clock: ClockLike;
  private readonly idleMs: number;
  private readonly maxOpenKeys: number;
  private readonly epochs = new Map<number, EpochState>();
  private current: number;

  constructor(options: SealBagOptions) {
    const { clock, idleMs, maxOpenKeys = DEFAULT_MAX_OPEN_KEYS } = options;
    if (!Number.isInteger(idleMs) || idleMs < 1) {
      throw new InvalidConfigError("idleMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxOpenKeys) || maxOpenKeys < 1) {
      throw new InvalidConfigError("maxOpenKeys must be an integer >= 1");
    }
    this.clock = clock;
    this.idleMs = idleMs;
    this.maxOpenKeys = maxOpenKeys;
    this.current = 1;
    this.epochs.set(1, {
      status: "open",
      order: [],
      payloads: new Map(),
      lastPutAt: null,
    });
  }

  private openEpoch(): EpochState {
    const epoch = this.epochs.get(this.current);
    if (!epoch) {
      throw new SealBagError("internal: missing open epoch");
    }
    return epoch;
  }

  put(key: string, payload: unknown): PutResult {
    assertValidKey(key);
    const epoch = this.openEpoch();
    const now = this.clock.now();
    if (epoch.payloads.has(key)) {
      epoch.payloads.set(key, payload);
      epoch.lastPutAt = now;
      return { epoch: this.current, status: "updated" };
    }
    if (epoch.order.length >= this.maxOpenKeys) {
      throw new CapacityError(
        `open epoch ${this.current} already holds ${this.maxOpenKeys} keys`,
      );
    }
    epoch.order.push(key);
    epoch.payloads.set(key, payload);
    epoch.lastPutAt = now;
    return { epoch: this.current, status: "accepted" };
  }

  seal(): { epoch: number } {
    const sealedEpoch = this.current;
    const epoch = this.openEpoch();
    epoch.status = epoch.order.length === 0 ? "drained" : "sealed";
    this.current = sealedEpoch + 1;
    this.epochs.set(this.current, {
      status: "open",
      order: [],
      payloads: new Map(),
      lastPutAt: null,
    });
    return { epoch: sealedEpoch };
  }

  drive(): { sealed: number | null } {
    const epoch = this.openEpoch();
    if (
      epoch.order.length === 0 ||
      epoch.lastPutAt === null ||
      this.clock.now() < epoch.lastPutAt + this.idleMs
    ) {
      return { sealed: null };
    }
    return { sealed: this.seal().epoch };
  }

  take(): TakeResult | null {
    for (const [epochNo, epoch] of this.epochs) {
      if (epoch.status !== "sealed") {
        continue;
      }
      const key = epoch.order.shift();
      if (key === undefined) {
        epoch.status = "drained";
        continue;
      }
      const payload = epoch.payloads.get(key);
      epoch.payloads.delete(key);
      if (epoch.order.length === 0) {
        epoch.status = "drained";
      }
      return { epoch: epochNo, key, payload };
    }
    return null;
  }

  cancel(key: string): boolean {
    assertValidKey(key);
    const epoch = this.openEpoch();
    if (!epoch.payloads.has(key)) {
      return false;
    }
    epoch.payloads.delete(key);
    const index = epoch.order.indexOf(key);
    if (index >= 0) {
      epoch.order.splice(index, 1);
    }
    if (epoch.order.length === 0) {
      epoch.lastPutAt = null;
    }
    return true;
  }

  currentEpoch(): number {
    return this.current;
  }

  statusOf(epoch: number): EpochStatus {
    const state = this.epochs.get(epoch);
    if (!state) {
      throw new UnknownEpochError(`unknown epoch ${epoch}`);
    }
    return state.status;
  }

  openKeys(): string[] {
    return [...this.openEpoch().order];
  }

  readyCount(): number {
    let total = 0;
    for (const epoch of this.epochs.values()) {
      if (epoch.status === "sealed") {
        total += epoch.order.length;
      }
    }
    return total;
  }

  peekOpen(key: string): unknown {
    assertValidKey(key);
    return this.openEpoch().payloads.get(key);
  }
}
