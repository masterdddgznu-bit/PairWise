import {
  VirtualClock,
  EpochGc,
  InvalidThreadError,
  AlreadyPinnedError,
  DuplicateRetireError,
  isUnblocked,
  ThreadTable,
} from "../src/index.js";
import type { RetireRecord } from "../src/index.js";

function make(opts?: { threadCount?: number; reclaimDelay?: number }) {
  const clock = new VirtualClock();
  const gc = new EpochGc({
    clock,
    threadCount: opts?.threadCount ?? 3,
    reclaimDelay: opts?.reclaimDelay ?? 0,
  });
  return { clock, gc };
}

describe("epochgc helpers", () => {
  test("isUnblocked false while pin at retired epoch", () => {
    const t = new ThreadTable(2);
    t.pin(0, 0);
    const rec: RetireRecord = { id: "a", epoch: 0, eligibleAt: null };
    expect(isUnblocked(rec, t)).toBe(false);
    t.unpin(0);
    expect(isUnblocked(rec, t)).toBe(true);
  });

  test("isUnblocked true when pin is strictly newer", () => {
    const t = new ThreadTable(1);
    t.pin(0, 2);
    const rec: RetireRecord = { id: "a", epoch: 1, eligibleAt: null };
    expect(isUnblocked(rec, t)).toBe(true);
  });
});

describe("epochgc pin unpin bump", () => {
  test("pin returns current epoch and minPinned tracks", () => {
    const { gc } = make();
    expect(gc.currentEpoch()).toBe(0);
    expect(gc.minPinned()).toBe(null);
    expect(gc.pin(0)).toBe(0);
    expect(gc.minPinned()).toBe(0);
    gc.bump();
    expect(gc.currentEpoch()).toBe(1);
    expect(gc.minPinned()).toBe(0);
    expect(gc.pin(1)).toBe(1);
    expect(gc.minPinned()).toBe(0);
    expect(gc.unpin(0)).toBe(true);
    expect(gc.minPinned()).toBe(1);
    expect(gc.unpin(0)).toBe(false);
  });

  test("repeat pin throws", () => {
    const { gc } = make();
    gc.pin(0);
    expect(() => gc.pin(0)).toThrow(AlreadyPinnedError);
  });

  test("invalid thread throws", () => {
    const { gc } = make({ threadCount: 2 });
    expect(() => gc.pin(2)).toThrow(InvalidThreadError);
    expect(() => gc.unpin(-1)).toThrow(InvalidThreadError);
  });
});

describe("epochgc retire reclaim", () => {
  test("pinned same epoch blocks reclaim", () => {
    const { gc } = make();
    gc.pin(0);
    gc.retire("x");
    expect(gc.reclaim()).toEqual([]);
    expect(gc.pendingCount()).toBe(1);
    gc.unpin(0);
    expect(gc.reclaim()).toEqual(["x"]);
    expect(gc.pendingCount()).toBe(0);
  });

  test("second thread still pinned blocks", () => {
    const { gc } = make();
    gc.pin(0);
    gc.pin(1);
    gc.retire("a");
    gc.unpin(0);
    expect(gc.reclaim()).toEqual([]);
    gc.unpin(1);
    expect(gc.reclaim()).toEqual(["a"]);
  });

  test("newer pin does not block older retire", () => {
    const { gc } = make();
    gc.pin(0);
    gc.retire("old");
    gc.bump();
    gc.unpin(0);
    expect(gc.pin(0)).toBe(1);
    expect(gc.reclaim()).toEqual(["old"]);
  });

  test("retire after bump uses new epoch", () => {
    const { gc } = make();
    gc.pin(0);
    gc.bump();
    gc.retire("n");
    expect(gc.reclaim()).toEqual([]);
    gc.unpin(0);
    expect(gc.reclaim()).toEqual(["n"]);
  });

  test("retire order preserved on batch reclaim", () => {
    const { gc } = make();
    gc.retire("a");
    gc.retire("b");
    gc.retire("c");
    expect(gc.reclaim()).toEqual(["a", "b", "c"]);
  });

  test("duplicate pending retire throws", () => {
    const { gc } = make();
    gc.pin(0);
    gc.retire("dup");
    expect(() => gc.retire("dup")).toThrow(DuplicateRetireError);
    gc.unpin(0);
    gc.reclaim();
    gc.retire("dup");
    expect(gc.reclaim()).toEqual(["dup"]);
  });

  test("reclaimDelay waits VirtualClock", () => {
    const { clock, gc } = make({ reclaimDelay: 5 });
    gc.retire("d");
    expect(gc.reclaim()).toEqual([]);
    clock.advance(4);
    expect(gc.reclaim()).toEqual([]);
    clock.advance(1);
    expect(gc.reclaim()).toEqual(["d"]);
  });

  test("tick advances one then reclaims", () => {
    const { clock, gc } = make({ reclaimDelay: 2 });
    gc.retire("t");
    expect(gc.tick()).toEqual([]);
    expect(clock.now()).toBe(1);
    expect(gc.tick()).toEqual(["t"]);
    expect(clock.now()).toBe(2);
  });

  test("eligibleAt sticks after first unblock", () => {
    const { clock, gc } = make({ reclaimDelay: 3, threadCount: 1 });
    gc.pin(0);
    gc.retire("z");
    clock.advance(10);
    expect(gc.reclaim()).toEqual([]);
    gc.unpin(0);
    expect(gc.reclaim()).toEqual([]);
    clock.advance(2);
    expect(gc.reclaim()).toEqual([]);
    clock.advance(1);
    expect(gc.reclaim()).toEqual(["z"]);
  });

  test("unregister unblocks retire", () => {
    const { gc } = make({ threadCount: 2 });
    gc.pin(0);
    gc.retire("u");
    gc.unregister(0);
    expect(gc.reclaim()).toEqual(["u"]);
    expect(() => gc.pin(0)).toThrow(InvalidThreadError);
  });

  test("empty reclaim is noop", () => {
    const { gc } = make();
    expect(gc.reclaim()).toEqual([]);
    expect(gc.pendingCount()).toBe(0);
  });

  test("mixed blocked and free items", () => {
    const { gc } = make();
    gc.retire("free");
    gc.bump();
    gc.pin(1);
    gc.retire("held");
    expect(gc.reclaim()).toEqual(["free"]);
    expect(gc.pendingCount()).toBe(1);
    gc.unpin(1);
    expect(gc.reclaim()).toEqual(["held"]);
  });
});
