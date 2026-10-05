import {
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
  SwapBlockedError,
} from "./errors.js";
import type { VirtualClock } from "./clock.js";

export interface TwinBufOptions {
  clock: VirtualClock;
  idleMs: number;
  maxStaging?: number;
}

export type WriteResult = { status: "accepted" | "updated" };
export type TakeResult = { key: string; payload: unknown } | null;

function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError("key must be a non-empty string");
  }
}

function assertPositiveInt(value: unknown, name: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new InvalidConfigError(`${name} must be an integer >= 1, got ${value}`);
  }
}

export class TwinBuf {
  private readonly clock: VirtualClock;
  private readonly idleMs: number;
  private readonly maxStaging: number;

  private staging = new Map<string, unknown>();
  private active = new Map<string, unknown>();
  private lastWriteAt: number | null = null;

  constructor(options: TwinBufOptions) {
    if (options === null || typeof options !== "object") {
      throw new InvalidConfigError("options object is required");
    }
    if (options.clock === null || typeof options.clock !== "object" ||
        typeof options.clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    assertPositiveInt(options.idleMs, "idleMs");
    const maxStaging = options.maxStaging ?? 16;
    assertPositiveInt(maxStaging, "maxStaging");

    this.clock = options.clock;
    this.idleMs = options.idleMs;
    this.maxStaging = maxStaging;
  }

  write(key: string, payload: unknown): WriteResult {
    assertValidKey(key);
    const now = this.clock.now();
    if (this.staging.has(key)) {
      this.staging.set(key, payload);
      this.lastWriteAt = now;
      return { status: "updated" };
    }
    if (this.staging.size >= this.maxStaging) {
      throw new CapacityError(
        `staging capacity ${this.maxStaging} reached; cannot add key ${JSON.stringify(key)}`,
      );
    }
    this.staging.set(key, payload);
    this.lastWriteAt = now;
    return { status: "accepted" };
  }

  swap(): boolean {
    if (this.active.size > 0) {
      throw new SwapBlockedError("active buffer still has un-taken entries");
    }
    if (this.staging.size === 0) {
      return false;
    }
    this.active = this.staging;
    this.staging = new Map();
    this.lastWriteAt = null;
    return true;
  }

  drive(): { swapped: boolean } {
    if (
      this.staging.size === 0 ||
      this.lastWriteAt === null ||
      this.active.size > 0 ||
      this.clock.now() < this.lastWriteAt + this.idleMs
    ) {
      return { swapped: false };
    }
    this.active = this.staging;
    this.staging = new Map();
    this.lastWriteAt = null;
    return { swapped: true };
  }

  take(): TakeResult {
    const first = this.active.keys().next();
    if (first.done) {
      return null;
    }
    const key = first.value;
    const payload = this.active.get(key);
    this.active.delete(key);
    return { key, payload };
  }

  cancel(key: string): boolean {
    assertValidKey(key);
    if (!this.staging.delete(key)) {
      return false;
    }
    if (this.staging.size === 0) {
      this.lastWriteAt = null;
    }
    return true;
  }

  stagingKeys(): string[] {
    return [...this.staging.keys()];
  }

  activeKeys(): string[] {
    return [...this.active.keys()];
  }

  stagingCount(): number {
    return this.staging.size;
  }

  activeCount(): number {
    return this.active.size;
  }

  peekStaging(key: string): unknown {
    assertValidKey(key);
    return this.staging.get(key);
  }

  peekActive(key: string): unknown {
    assertValidKey(key);
    return this.active.get(key);
  }
}
