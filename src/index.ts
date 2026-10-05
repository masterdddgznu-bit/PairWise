export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (ms < 0) {
      throw new Error("cannot advance clock by a negative amount");
    }
    this.current += ms;
  }
}

export class TwinBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TwinBufError {}
export class InvalidKeyError extends TwinBufError {}
export class CapacityError extends TwinBufError {}
export class SwapBlockedError extends TwinBufError {}

export interface TwinBufOptions {
  clock: VirtualClock;
  idleMs: number;
  maxStaging?: number;
}

export type WriteResult = { status: "accepted" | "updated" };

export class TwinBuf {
  private readonly clock: VirtualClock;
  private readonly idleMs: number;
  private readonly maxStaging: number;
  private staging = new Map<string, unknown>();
  private active = new Map<string, unknown>();
  private lastWriteAt: number | null = null;

  constructor(options: TwinBufOptions) {
    const { clock, idleMs, maxStaging = 16 } = options;
    if (!Number.isInteger(idleMs) || idleMs < 1) {
      throw new InvalidConfigError("idleMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxStaging) || maxStaging < 1) {
      throw new InvalidConfigError("maxStaging must be an integer >= 1");
    }
    this.clock = clock;
    this.idleMs = idleMs;
    this.maxStaging = maxStaging;
  }

  private static checkKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidKeyError("key must be a non-empty string");
    }
  }

  write(key: string, payload: unknown): WriteResult {
    TwinBuf.checkKey(key);
    const now = this.clock.now();
    if (this.staging.has(key)) {
      this.staging.set(key, payload);
      this.lastWriteAt = now;
      return { status: "updated" };
    }
    if (this.staging.size >= this.maxStaging) {
      throw new CapacityError("staging capacity reached");
    }
    this.staging.set(key, payload);
    this.lastWriteAt = now;
    return { status: "accepted" };
  }

  swap(): boolean {
    if (this.active.size > 0) {
      throw new SwapBlockedError("active buffer is not drained");
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
      this.clock.now() < this.lastWriteAt + this.idleMs ||
      this.active.size > 0
    ) {
      return { swapped: false };
    }
    this.active = this.staging;
    this.staging = new Map();
    this.lastWriteAt = null;
    return { swapped: true };
  }

  take(): { key: string; payload: unknown } | null {
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
    TwinBuf.checkKey(key);
    if (!this.staging.has(key)) {
      return false;
    }
    this.staging.delete(key);
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
    TwinBuf.checkKey(key);
    return this.staging.get(key);
  }

  peekActive(key: string): unknown {
    TwinBuf.checkKey(key);
    return this.active.get(key);
  }
}
