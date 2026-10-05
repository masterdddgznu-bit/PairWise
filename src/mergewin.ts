import { VirtualClock } from "./clock.js";
import {
  BarrierError,
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
  InvalidVersionError,
} from "./errors.js";

export interface MergeWinOptions {
  clock: VirtualClock;
  idleMs: number;
  maxKeys?: number;
}

export type PutStatus = "accepted" | "updated" | "merged" | "ignored";

export interface PutResult {
  status: PutStatus;
}

export interface FlushItem {
  key: string;
  payload: unknown;
  version: number;
}

export interface FlushResult {
  items: FlushItem[];
}

interface PendingEntry {
  key: string;
  payload: unknown;
  version: number;
  touchedAt: number;
  barrierGen: number;
}

const DEFAULT_MAX_KEYS = 16;

export class MergeWin {
  private readonly clock: VirtualClock;
  private readonly idleMs: number;
  private readonly maxKeys: number;
  private readonly entries = new Map<string, PendingEntry>();
  private readonly releasedGens = new Set<number>();
  private openGen = 0;
  private nextGen = 0;

  constructor(options: MergeWinOptions) {
    const { clock, idleMs, maxKeys = DEFAULT_MAX_KEYS } = options;
    if (!Number.isInteger(idleMs) || idleMs < 1) {
      throw new InvalidConfigError("idleMs must be an integer >= 1");
    }
    if (!Number.isInteger(maxKeys) || maxKeys < 1) {
      throw new InvalidConfigError("maxKeys must be an integer >= 1");
    }
    this.clock = clock;
    this.idleMs = idleMs;
    this.maxKeys = maxKeys;
  }

  put(key: string, payload: unknown, version = 0): PutResult {
    this.assertKey(key);
    if (!Number.isInteger(version) || version < 0) {
      throw new InvalidVersionError("version must be an integer >= 0");
    }
    const existing = this.entries.get(key);
    if (existing === undefined) {
      if (this.entries.size >= this.maxKeys) {
        throw new CapacityError(`pending window is full (${this.maxKeys} keys)`);
      }
      this.entries.set(key, {
        key,
        payload,
        version,
        touchedAt: this.clock.now(),
        barrierGen: this.openGen,
      });
      return { status: "accepted" };
    }
    if (version > existing.version) {
      existing.payload = payload;
      existing.version = version;
      existing.touchedAt = this.clock.now();
      existing.barrierGen = this.openGen;
      return { status: "updated" };
    }
    if (version === existing.version) {
      existing.payload = payload;
      existing.touchedAt = this.clock.now();
      existing.barrierGen = this.openGen;
      return { status: "merged" };
    }
    return { status: "ignored" };
  }

  cancel(key: string): boolean {
    this.assertKey(key);
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
    this.releasedGens.add(this.openGen);
    this.openGen = 0;
    return true;
  }

  isBarrierOpen(): boolean {
    return this.openGen !== 0;
  }

  currentBarrier(): number {
    return this.openGen;
  }

  flush(): FlushResult {
    return this.drain(() => true);
  }

  drive(): FlushResult {
    const now = this.clock.now();
    return this.drain((entry) => now >= entry.touchedAt + this.idleMs);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  size(): number {
    return this.entries.size;
  }

  peek(key: string): unknown {
    this.assertKey(key);
    return this.entries.get(key)?.payload;
  }

  versionOf(key: string): number | null {
    this.assertKey(key);
    return this.entries.get(key)?.version ?? null;
  }

  touchedAt(key: string): number | null {
    this.assertKey(key);
    return this.entries.get(key)?.touchedAt ?? null;
  }

  barrierGenOf(key: string): number | null {
    this.assertKey(key);
    return this.entries.get(key)?.barrierGen ?? null;
  }

  private drain(eligible: (entry: PendingEntry) => boolean): FlushResult {
    const items: FlushItem[] = [];
    for (const [key, entry] of this.entries) {
      if (!this.isReleased(entry) || !eligible(entry)) {
        continue;
      }
      items.push({ key, payload: entry.payload, version: entry.version });
      this.entries.delete(key);
    }
    return { items };
  }

  private isReleased(entry: PendingEntry): boolean {
    return entry.barrierGen === 0 || this.releasedGens.has(entry.barrierGen);
  }

  private assertKey(key: string): void {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidKeyError("key must be a non-empty string");
    }
  }
}
