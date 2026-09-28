import { VirtualClock } from "./clock.js";
import { MapRoot } from "./root.js";
import type { DiffResult, SnapOpts, Stats } from "./types.js";

/**
 * Copy-on-write snapshot store.
 * Base HEAD put/get/delete/has/keys/size work.
 */
export class SnapStore {
  readonly clock: VirtualClock;
  /** @internal */ readonly head: MapRoot;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.head = new MapRoot();
  }

  put(key: string, value: string): void {
    this.head.put(key, value);
  }

  get(key: string): string | undefined {
    return this.head.get(key);
  }

  delete(key: string): boolean {
    return this.head.delete(key);
  }

  has(key: string): boolean {
    return this.head.has(key);
  }

  keys(): string[] {
    return this.head.keys();
  }

  size(): number {
    return this.head.size();
  }

  snapshot(_opts?: SnapOpts): string {
    throw new Error("snapshot not implemented");
  }

  getAt(_snapId: string, _key: string): string | undefined {
    throw new Error("getAt not implemented");
  }

  hasAt(_snapId: string, _key: string): boolean {
    throw new Error("hasAt not implemented");
  }

  keysAt(_snapId: string): string[] {
    throw new Error("keysAt not implemented");
  }

  sizeAt(_snapId: string): number {
    throw new Error("sizeAt not implemented");
  }

  fork(_snapId: string): void {
    throw new Error("fork not implemented");
  }

  diff(_a: string, _b: string): DiffResult {
    throw new Error("diff not implemented");
  }

  drop(_snapId: string): boolean {
    throw new Error("drop not implemented");
  }

  listSnapshots(): string[] {
    throw new Error("listSnapshots not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }

  stats(): Stats {
    throw new Error("stats not implemented");
  }
}
