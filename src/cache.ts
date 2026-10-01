import type { VirtualClock } from "./clock.js";
import type { CacheGetResult, CacheSnapshot, CacheStats } from "./types.js";
import { CacheStore } from "./store.js";
import { Singleflight } from "./singleflight.js";
import { computeExpiresAt } from "./entry.js";
import { exportSnapshot, importSnapshot } from "./recover.js";

export type TokenCacheOptions = {
  defaultTtlMs?: number;
};

export class TokenCache {
  private store = new CacheStore();
  private flight = new Singleflight();

  constructor(
    private readonly clock: VirtualClock,
    private readonly opts: TokenCacheOptions = {},
  ) {}

  private ttlMs(override?: number): number {
    return override ?? this.opts.defaultTtlMs ?? 60_000;
  }

  private flightKey(tenant: string, key: string): string {
    return `${tenant}\0${key}`;
  }

  get<V = unknown>(tenant: string, key: string): CacheGetResult<V> | undefined {
    const rec = this.store.get(tenant, key);
    if (!rec) return undefined;
    return { value: rec.value as V, generation: rec.generation };
  }

  set<V = unknown>(
    tenant: string,
    key: string,
    value: V,
    ttlMs?: number,
  ): { generation: number } {
    const now = this.clock.now();
    const generation = this.store.bumpGeneration(tenant, key);
    const expiresAt = computeExpiresAt(now, this.ttlMs(ttlMs));
    this.store.put({ tenant, key, value, generation, expiresAt });
    return { generation };
  }

  invalidate(tenant: string, key: string): void {
    this.store.remove(tenant, key);
  }

  compareAndSet<V = unknown>(
    tenant: string,
    key: string,
    _expectedGen: number,
    value: V,
    ttlMs?: number,
  ): boolean {
    const now = this.clock.now();
    const generation = this.store.bumpGeneration(tenant, key);
    const expiresAt = computeExpiresAt(now, this.ttlMs(ttlMs));
    this.store.put({ tenant, key, value, generation, expiresAt });
    return true;
  }

  load<V = unknown>(
    tenant: string,
    key: string,
    loader: () => V,
    ttlMs?: number,
  ): V {
    const cached = this.get<V>(tenant, key);
    if (cached !== undefined) {
      return cached.value;
    }
    const fk = this.flightKey(tenant, key);
    return this.flight.run(fk, () => {
      const again = this.get<V>(tenant, key);
      if (again !== undefined) {
        return again.value;
      }
      const value = loader();
      this.set(tenant, key, value, ttlMs);
      return value;
    });
  }

  gc(): void {
    this.store.gc(this.clock.now());
  }

  size(tenant?: string): number {
    return this.store.countIndexed(tenant);
  }

  stats(): CacheStats {
    return { inflight: this.flight.inflightCount() };
  }

  exportState(): CacheSnapshot {
    return exportSnapshot(this.store);
  }

  importState(state: CacheSnapshot): void {
    importSnapshot(this.store, this.clock, this.ttlMs(), state);
  }
}
