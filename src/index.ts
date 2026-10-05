export class MergeWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends MergeWinError {}
export class InvalidKeyError extends MergeWinError {}
export class InvalidVersionError extends MergeWinError {}
export class CapacityError extends MergeWinError {}
export class BarrierError extends MergeWinError {}

export class VirtualClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms < 0) {
      throw new MergeWinError(`advance requires a non-negative number, got ${ms}`);
    }
    this.current += ms;
  }
}

export type PutStatus = "accepted" | "updated" | "merged" | "ignored";

export interface MergeWinOptions {
  clock: VirtualClock;
  idleMs: number;
  maxKeys?: number;
}

export interface FlushItem {
  key: string;
  payload: unknown;
  version: number;
}

interface PendingEntry {
  payload: unknown;
  version: number;
  touchedAt: number;
  barrierGen: number;
}

function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length === 0) {
    throw new InvalidKeyError("key must be a non-empty string");
  }
}

export class MergeWin {
  private readonly clock: VirtualClock;
  private readonly idleMs: number;
  private readonly maxKeys: number;
  private readonly entries = new Map<string, PendingEntry>();
  private readonly releasedGens = new Set<number>();
  private openGen = 0;
  private nextGen = 0;

  constructor(options: MergeWinOptions) {
    const { clock, idleMs, maxKeys = 16 } = options;
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a clock with now() is required");
    }
    if (!Number.isInteger(idleMs) || idleMs < 1) {
      throw new InvalidConfigError(`idleMs must be an integer >= 1, got ${idleMs}`);
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new InvalidConfigError(`maxKeys must be an integer >= 1, got ${maxKeys}`);
    }
    this.clock = clock;
    this.idleMs = idleMs;
    this.maxKeys = maxKeys;
  }

  put(key: string, payload: unknown, version: number = 0): { status: PutStatus } {
    assertValidKey(key);
    if (!Number.isInteger(version) || version < 0) {
      throw new InvalidVersionError(`version must be an integer >= 0, got ${version}`);
    }
    const existing = this.entries.get(key);
    const now = this.clock.now();
    if (existing === undefined) {
      if (this.entries.size >= this.maxKeys) {
        throw new CapacityError(`pending window is full (maxKeys=${this.maxKeys})`);
      }
      this.entries.set(key, {
        payload,
        version,
        touchedAt: now,
        barrierGen: this.openGen,
      });
      return { status: "accepted" };
    }
    if (version > existing.version) {
      existing.payload = payload;
      existing.version = version;
      existing.touchedAt = now;
      existing.barrierGen = this.openGen;
      return { status: "updated" };
    }
    if (version === existing.version) {
      existing.payload = payload;
      existing.touchedAt = now;
      existing.barrierGen = this.openGen;
      return { status: "merged" };
    }
    return { status: "ignored" };
  }

  cancel(key: string): boolean {
    assertValidKey(key);
    return this.entries.delete(key);
  }

  openBarrier(): number {
    if (this.openGen !== 0) {
      throw new BarrierError(`barrier generation ${this.openGen} is still open`);
    }
    this.nextGen += 1;
    this.openGen = this.nextGen;
    return this.openGen;
  }

  closeBarrier(gen: number): boolean {
    if (gen !== this.openGen || this.openGen === 0) {
      return false;
    }
    this.releasedGens.add(gen);
    this.openGen = 0;
    return true;
  }

  isBarrierOpen(): boolean {
    return this.openGen !== 0;
  }

  currentBarrier(): number {
    return this.openGen;
  }

  flush(): { items: FlushItem[] } {
    const items: FlushItem[] = [];
    for (const [key, entry] of this.entries) {
      if (!this.isReleased(entry)) continue;
      items.push({ key, payload: entry.payload, version: entry.version });
      this.entries.delete(key);
    }
    return { items };
  }

  drive(): { items: FlushItem[] } {
    const items: FlushItem[] = [];
    const now = this.clock.now();
    for (const [key, entry] of this.entries) {
      if (!this.isReleased(entry)) continue;
      if (now < entry.touchedAt + this.idleMs) continue;
      items.push({ key, payload: entry.payload, version: entry.version });
      this.entries.delete(key);
    }
    return { items };
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  size(): number {
    return this.entries.size;
  }

  peek(key: string): unknown {
    assertValidKey(key);
    return this.entries.get(key)?.payload;
  }

  versionOf(key: string): number | null {
    assertValidKey(key);
    return this.entries.get(key)?.version ?? null;
  }

  touchedAt(key: string): number | null {
    assertValidKey(key);
    return this.entries.get(key)?.touchedAt ?? null;
  }

  barrierGenOf(key: string): number | null {
    assertValidKey(key);
    return this.entries.get(key)?.barrierGen ?? null;
  }

  private isReleased(entry: PendingEntry): boolean {
    return entry.barrierGen === 0 || this.releasedGens.has(entry.barrierGen);
  }
}
