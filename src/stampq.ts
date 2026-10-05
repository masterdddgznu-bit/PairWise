import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  IllegalOpError,
  InvalidConfigError,
  InvalidIdError,
  InvalidStampError,
  InvalidWatermarkError,
  UnknownIdError,
} from "./errors.js";
import { EventLog } from "./log.js";

type ItemStatus = "unstamped" | "stamped";

interface Item {
  id: string;
  payload: unknown;
  status: ItemStatus;
  stamp: number | null;
  offerSeq: number;
  stampSeq: number;
}

export interface StampQOptions {
  clock: VirtualClock;
  maxItems?: number;
  initialWatermark?: number;
}

export interface ReleasableItem<T = unknown> {
  id: string;
  payload: T;
  stamp: number;
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidStamp(stamp: unknown): asserts stamp is number {
  if (typeof stamp !== "number" || !Number.isInteger(stamp)) {
    throw new InvalidStampError("stamp must be a finite integer");
  }
}

export class StampQ {
  private readonly clock: VirtualClock;
  private readonly maxItems: number;
  private readonly log = new EventLog();
  private readonly items = new Map<string, Item>();
  private currentWatermark: number;

  constructor(options: StampQOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      !(options.clock instanceof VirtualClock)
    ) {
      throw new InvalidConfigError("a VirtualClock instance is required");
    }
    const maxItems = options.maxItems ?? 16;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError("maxItems must be an integer >= 1");
    }
    const initialWatermark = options.initialWatermark ?? -1;
    if (
      typeof initialWatermark !== "number" ||
      !Number.isInteger(initialWatermark)
    ) {
      throw new InvalidConfigError("initialWatermark must be a finite integer");
    }
    this.clock = options.clock;
    this.maxItems = maxItems;
    this.currentWatermark = initialWatermark;
  }

  offer(id: string, payload: unknown): { status: "accepted" } {
    assertValidId(id);
    if (this.items.has(id)) {
      throw new IllegalOpError(`duplicate id: ${id}`);
    }
    if (this.items.size >= this.maxItems) {
      throw new CapacityError("queue is at capacity");
    }
    const event = this.log.append(this.clock.now(), "offer", { id });
    this.items.set(id, {
      id,
      payload,
      status: "unstamped",
      stamp: null,
      offerSeq: event.seq,
      stampSeq: -1,
    });
    return { status: "accepted" };
  }

  stamp(id: string, stamp: number): boolean {
    assertValidId(id);
    assertValidStamp(stamp);
    const item = this.requireItem(id);
    if (item.status === "stamped") {
      throw new IllegalOpError(`item already stamped: ${id}`);
    }
    item.status = "stamped";
    item.stamp = stamp;
    item.stampSeq = this.log.append(this.clock.now(), "stamp", { id, stamp }).seq;
    return true;
  }

  restamp(id: string, stamp: number): boolean {
    assertValidId(id);
    assertValidStamp(stamp);
    const item = this.requireItem(id);
    if (item.status !== "stamped") {
      throw new IllegalOpError(`item is not stamped: ${id}`);
    }
    item.stamp = stamp;
    item.stampSeq = this.log.append(this.clock.now(), "restamp", { id, stamp }).seq;
    return true;
  }

  advanceWatermark(wm: number): number {
    if (typeof wm !== "number" || !Number.isInteger(wm)) {
      throw new InvalidWatermarkError("watermark must be a finite integer");
    }
    if (wm < this.currentWatermark) {
      throw new IllegalOpError("watermark cannot regress");
    }
    if (wm > this.currentWatermark) {
      this.currentWatermark = wm;
    }
    this.log.append(this.clock.now(), "watermark", {
      watermark: this.currentWatermark,
    });
    return this.currentWatermark;
  }

  peek(): ReleasableItem | null {
    const next = this.nextReleasable(this.currentWatermark);
    return next === null ? null : this.toReleasable(next);
  }

  pop(): ReleasableItem | null {
    const next = this.nextReleasable(this.currentWatermark);
    if (next === null) {
      return null;
    }
    this.items.delete(next.id);
    this.log.append(this.clock.now(), "pop", {
      id: next.id,
      stamp: next.stamp ?? undefined,
    });
    return this.toReleasable(next);
  }

  drive(): { drained: ReleasableItem[] } {
    const watermark = this.currentWatermark;
    const drained: ReleasableItem[] = [];
    for (;;) {
      const next = this.nextReleasable(watermark);
      if (next === null) {
        break;
      }
      this.items.delete(next.id);
      this.log.append(this.clock.now(), "pop", {
        id: next.id,
        stamp: next.stamp ?? undefined,
      });
      drained.push(this.toReleasable(next));
    }
    return { drained };
  }

  cancel(id: string): boolean {
    assertValidId(id);
    if (!this.items.has(id)) {
      return false;
    }
    this.items.delete(id);
    this.log.append(this.clock.now(), "cancel", { id });
    return true;
  }

  watermark(): number {
    return this.currentWatermark;
  }

  size(): number {
    return this.items.size;
  }

  ids(): string[] {
    return [...this.items.values()]
      .sort((a, b) => a.offerSeq - b.offerSeq)
      .map((item) => item.id);
  }

  stampOf(id: string): number | null {
    assertValidId(id);
    const item = this.items.get(id);
    if (item === undefined || item.status !== "stamped") {
      return null;
    }
    return item.stamp;
  }

  isReleasable(id: string): boolean {
    assertValidId(id);
    const item = this.requireItem(id);
    return item.status === "stamped" && item.stamp! <= this.currentWatermark;
  }

  events() {
    return this.log.all();
  }

  private requireItem(id: string): Item {
    const item = this.items.get(id);
    if (item === undefined) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return item;
  }

  private nextReleasable(watermark: number): Item | null {
    let best: Item | null = null;
    for (const item of this.items.values()) {
      if (item.status !== "stamped" || item.stamp! > watermark) {
        continue;
      }
      if (
        best === null ||
        item.stamp! < best.stamp! ||
        (item.stamp === best.stamp &&
          (item.stampSeq < best.stampSeq ||
            (item.stampSeq === best.stampSeq &&
              item.offerSeq < best.offerSeq)))
      ) {
        best = item;
      }
    }
    return best;
  }

  private toReleasable(item: Item): ReleasableItem {
    return { id: item.id, payload: item.payload, stamp: item.stamp! };
  }
}
