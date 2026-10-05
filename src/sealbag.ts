import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
  UnknownEpochError,
} from "./errors.js";

export type EpochStatus = "open" | "sealed" | "drained";

export interface SealBagOptions {
  clock: VirtualClock;
  idleMs: number;
  maxOpenKeys?: number;
}

export interface PutResult {
  epoch: number;
  status: "accepted" | "updated";
}

export interface TakeResult {
  epoch: number;
  key: string;
  payload: unknown;
}

interface Epoch {
  status: EpochStatus;
  order: string[];
  payloads: Map<string, unknown>;
  lastPutAt: number | null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class SealBag {
  private readonly clock: VirtualClock;
  private readonly idleMs: number;
  private readonly maxOpenKeys: number;
  private readonly epochs = new Map<number, Epoch>();
  private current = 1;

  constructor(options: SealBagOptions) {
    const { clock, idleMs, maxOpenKeys = 16 } = options;
    if (!isPositiveInteger(idleMs) || !isPositiveInteger(maxOpenKeys)) {
      throw new InvalidConfigError(
        "idleMs and maxOpenKeys must be integers >= 1",
      );
    }
    this.clock = clock;
    this.idleMs = idleMs;
    this.maxOpenKeys = maxOpenKeys;
    this.epochs.set(1, this.freshEpoch("open"));
  }

  private freshEpoch(status: EpochStatus): Epoch {
    return { status, order: [], payloads: new Map(), lastPutAt: null };
  }

  private openEpoch(): Epoch {
    const epoch = this.epochs.get(this.current);
    if (!epoch) {
      throw new UnknownEpochError(`unknown epoch ${this.current}`);
    }
    return epoch;
  }

  private static assertKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidKeyError("key must be a non-empty string");
    }
  }

  put(key: string, payload: unknown): PutResult {
    SealBag.assertKey(key);
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
    this.epochs.set(this.current, this.freshEpoch("open"));
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
    for (const [id, epoch] of this.epochs) {
      if (epoch.status !== "sealed") {
        continue;
      }
      const key = epoch.order.shift();
      if (key === undefined) {
        continue;
      }
      const payload = epoch.payloads.get(key);
      epoch.payloads.delete(key);
      if (epoch.order.length === 0) {
        epoch.status = "drained";
      }
      return { epoch: id, key, payload };
    }
    return null;
  }

  cancel(key: string): boolean {
    SealBag.assertKey(key);
    const epoch = this.openEpoch();
    if (!epoch.payloads.has(key)) {
      return false;
    }
    epoch.payloads.delete(key);
    epoch.order = epoch.order.filter((k) => k !== key);
    if (epoch.order.length === 0) {
      epoch.lastPutAt = null;
    }
    return true;
  }

  currentEpoch(): number {
    return this.current;
  }

  statusOf(epoch: number): EpochStatus {
    const found = this.epochs.get(epoch);
    if (!found) {
      throw new UnknownEpochError(`unknown epoch ${epoch}`);
    }
    return found.status;
  }

  openKeys(): string[] {
    return [...this.openEpoch().order];
  }

  readyCount(): number {
    let count = 0;
    for (const epoch of this.epochs.values()) {
      if (epoch.status === "sealed") {
        count += epoch.order.length;
      }
    }
    return count;
  }

  peekOpen(key: string): unknown {
    SealBag.assertKey(key);
    return this.openEpoch().payloads.get(key);
  }
}
