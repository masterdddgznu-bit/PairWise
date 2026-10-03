import { VirtualClock } from "./clock.js";
import {
  DuplicateLaneError,
  InvalidConfigError,
  LimitError,
  ReadOnlyError,
  UnknownLaneError,
} from "./errors.js";
import { deleteKey, overwriteKey, releaseLane } from "./gc.js";
import { LaneBook } from "./lanes.js";
import { PageStore } from "./pages.js";
import type { SnapLaneOptions } from "./types.js";

export class SnapLane {
  readonly clock: VirtualClock;
  private readonly maxSnaps: number;
  private readonly pages = new PageStore();
  private readonly book = new LaneBook();

  constructor(opts: SnapLaneOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    const maxSnaps = opts.maxSnaps ?? 16;
    if (!Number.isInteger(maxSnaps) || maxSnaps < 1) {
      throw new InvalidConfigError("maxSnaps");
    }
    this.clock = opts.clock;
    this.maxSnaps = maxSnaps;
    this.book.set({
      name: "head",
      kind: "head",
      readonly: false,
      deadline: null,
      entries: new Map(),
    });
  }

  private require(name: string) {
    const m = this.book.get(name);
    if (!m) throw new UnknownLaneError(name);
    return m;
  }

  private ensureSlot(name: string): void {
    if (this.book.has(name)) throw new DuplicateLaneError(name);
    if (this.book.nonHeadCount() >= this.maxSnaps) throw new LimitError("maxSnaps");
  }

  put(lane: string, key: string, value: string): void {
    const m = this.require(lane);
    if (m.readonly) throw new ReadOnlyError(lane);
    const id = this.pages.alloc(value);
    overwriteKey(m, this.pages, key, id);
  }

  get(lane: string, key: string): string | undefined {
    const m = this.require(lane);
    const id = m.entries.get(key);
    if (id === undefined) return undefined;
    return this.pages.get(id);
  }

  del(lane: string, key: string): boolean {
    const m = this.require(lane);
    if (m.readonly) throw new ReadOnlyError(lane);
    return deleteKey(m, this.pages, key);
  }

  snapshot(name: string, ttlMs: number | null = null, fromLane = "head"): void {
    const from = this.require(fromLane);
    this.ensureSlot(name);
    let deadline: number | null = null;
    if (ttlMs !== null && ttlMs !== undefined) {
      if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new InvalidConfigError("ttl");
      deadline = this.clock.now() + ttlMs;
    }
    const entries = this.book.cloneEntries(from, this.pages);
    this.book.set({
      name,
      kind: "snapshot",
      readonly: true,
      deadline,
      entries,
    });
  }

  branch(fromName: string, newName: string): void {
    const from = this.require(fromName);
    this.ensureSlot(newName);
    const entries = this.book.cloneEntries(from, this.pages);
    this.book.set({
      name: newName,
      kind: "branch",
      readonly: false,
      deadline: null,
      entries,
    });
  }

  drop(name: string): void {
    if (name === "head") throw new InvalidConfigError("head");
    const m = this.book.delete(name);
    if (!m) throw new UnknownLaneError(name);
    releaseLane(m, this.pages);
  }

  drive(): string[] {
    const ids = this.book.expired(this.clock.now());
    for (const name of ids) this.drop(name);
    return ids;
  }

  lanes(): string[] {
    return this.book.names();
  }

  isReadonly(name: string): boolean {
    return this.require(name).readonly;
  }
}
