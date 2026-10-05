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
import { EventLog, StampQEvent } from "./log.js";
import { RegisteredItem, Registry } from "./registry.js";

export interface StampQOptions {
  clock: VirtualClock;
  maxItems?: number;
  initialWatermark?: number;
}

export interface ReleasedItem {
  id: string;
  payload: unknown;
  stamp: number;
}

const DEFAULT_MAX_ITEMS = 16;
const DEFAULT_INITIAL_WATERMARK = -1;

export class StampQ {
  private readonly maxItems: number;
  private watermarkValue: number;
  private readonly log: EventLog;
  private readonly registry = new Registry();
  private offerCounter = 0;

  constructor(options: StampQOptions) {
    if (
      options === null ||
      typeof options !== "object" ||
      !(options.clock instanceof VirtualClock)
    ) {
      throw new InvalidConfigError("StampQ requires a VirtualClock as `clock`");
    }
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new InvalidConfigError(`maxItems must be an integer >= 1; got ${maxItems}`);
    }
    const initialWatermark = options.initialWatermark ?? DEFAULT_INITIAL_WATERMARK;
    if (!Number.isInteger(initialWatermark)) {
      throw new InvalidConfigError(
        `initialWatermark must be a finite integer; got ${initialWatermark}`,
      );
    }
    this.maxItems = maxItems;
    this.watermarkValue = initialWatermark;
    this.log = new EventLog(options.clock);
  }

  offer(id: string, payload: unknown): { status: "accepted" } {
    assertValidId(id);
    if (this.registry.has(id)) {
      throw new IllegalOpError(`duplicate id: ${id}`);
    }
    if (this.registry.size >= this.maxItems) {
      throw new CapacityError(`queue is full (maxItems=${this.maxItems})`);
    }
    this.log.append("offer", { id });
    this.registry.add({
      id,
      payload,
      offerSeq: this.offerCounter++,
      state: "unstamped",
      stamp: null,
      stampSeq: null,
    });
    return { status: "accepted" };
  }

  stamp(id: string, stamp: number): boolean {
    assertValidId(id);
    assertValidStamp(stamp);
    const item = this.requireItem(id);
    if (item.state === "stamped") {
      throw new IllegalOpError(`item already stamped: ${id}`);
    }
    const event = this.log.append("stamp", { id, stamp });
    item.state = "stamped";
    item.stamp = stamp;
    item.stampSeq = event.seq;
    return true;
  }

  restamp(id: string, stamp: number): boolean {
    assertValidId(id);
    assertValidStamp(stamp);
    const item = this.requireItem(id);
    if (item.state !== "stamped") {
      throw new IllegalOpError(`cannot restamp unstamped item: ${id}`);
    }
    const event = this.log.append("restamp", { id, stamp });
    item.stamp = stamp;
    item.stampSeq = event.seq;
    return true;
  }

  advanceWatermark(wm: number): number {
    if (typeof wm !== "number" || !Number.isInteger(wm)) {
      throw new InvalidWatermarkError(`watermark must be a finite integer; got ${wm}`);
    }
    if (wm < this.watermarkValue) {
      throw new IllegalOpError(
        `watermark cannot regress: ${wm} < ${this.watermarkValue}`,
      );
    }
    if (wm > this.watermarkValue) {
      this.watermarkValue = wm;
      this.log.append("watermark", { watermark: wm });
    }
    return this.watermarkValue;
  }

  peek(): ReleasedItem | null {
    const [head] = this.registry.releasable(this.watermarkValue);
    return head ? toReleased(head) : null;
  }

  pop(): ReleasedItem | null {
    const [head] = this.registry.releasable(this.watermarkValue);
    if (!head) return null;
    this.registry.remove(head.id);
    this.log.append("pop", { id: head.id, stamp: head.stamp ?? undefined });
    return toReleased(head);
  }

  drive(): { drained: ReleasedItem[] } {
    const snapshotWatermark = this.watermarkValue;
    const drained: ReleasedItem[] = [];
    for (;;) {
      const [head] = this.registry.releasable(snapshotWatermark);
      if (!head) break;
      this.registry.remove(head.id);
      this.log.append("pop", { id: head.id, stamp: head.stamp ?? undefined });
      drained.push(toReleased(head));
    }
    return { drained };
  }

  cancel(id: string): boolean {
    assertValidId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.log.append("cancel", { id });
    return true;
  }

  watermark(): number {
    return this.watermarkValue;
  }

  size(): number {
    return this.registry.size;
  }

  ids(): string[] {
    return this.registry.idsInOfferOrder();
  }

  stampOf(id: string): number | null {
    assertValidId(id);
    const item = this.registry.get(id);
    if (!item || item.state !== "stamped") return null;
    return item.stamp;
  }

  isReleasable(id: string): boolean {
    assertValidId(id);
    const item = this.registry.get(id);
    if (!item) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return (
      item.state === "stamped" &&
      item.stamp !== null &&
      item.stamp <= this.watermarkValue
    );
  }

  events(): StampQEvent[] {
    return this.log.all();
  }

  private requireItem(id: string): RegisteredItem {
    const item = this.registry.get(id);
    if (!item) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return item;
  }
}

function toReleased(item: RegisteredItem): ReleasedItem {
  return { id: item.id, payload: item.payload, stamp: item.stamp as number };
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`id must be a non-empty string; got ${String(id)}`);
  }
}

function assertValidStamp(stamp: unknown): asserts stamp is number {
  if (typeof stamp !== "number" || !Number.isInteger(stamp)) {
    throw new InvalidStampError(`stamp must be a finite integer; got ${String(stamp)}`);
  }
}
