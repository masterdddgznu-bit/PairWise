import {
  VirtualClock,
  DedupTtl,
  InvalidKeyError,
  InvalidConfigError,
  pickVictim,
  sortByExpiry,
  dueEntries,
} from "../src/index.js";
import type { Entry } from "../src/index.js";

function make(opts?: { ttl?: number; capacity?: number }) {
  const clock = new VirtualClock();
  const d = new DedupTtl({
    clock,
    ttl: opts?.ttl ?? 10,
    capacity: opts?.capacity ?? 8,
  });
  return { clock, d };
}

describe("dedupttl helpers", () => {
  test("sortByExpiry then seq", () => {
    const entries: Entry[] = [
      { key: "b", expireAt: 5, seq: 2 },
      { key: "a", expireAt: 3, seq: 1 },
      { key: "c", expireAt: 3, seq: 0 },
    ];
    expect(sortByExpiry(entries).map((e) => e.key)).toEqual(["c", "a", "b"]);
  });

  test("pickVictim earliest expiry", () => {
    const v = pickVictim([
      { key: "x", expireAt: 9, seq: 0 },
      { key: "y", expireAt: 4, seq: 1 },
    ]);
    expect(v?.key).toBe("y");
  });

  test("dueEntries filters and orders", () => {
    const due = dueEntries(
      [
        { key: "b", expireAt: 2, seq: 1 },
        { key: "a", expireAt: 2, seq: 0 },
        { key: "c", expireAt: 5, seq: 2 },
      ],
      2,
    );
    expect(due.map((e) => e.key)).toEqual(["a", "b"]);
  });
});

describe("dedupttl remember seen", () => {
  test("remember then seen", () => {
    const { d } = make();
    expect(d.remember("k")).toEqual({
      inserted: true,
      refreshed: false,
      evicted: null,
    });
    expect(d.seen("k")).toBe(true);
    expect(d.size()).toBe(1);
  });

  test("refresh extends ttl without new seq order change", () => {
    const { clock, d } = make({ ttl: 5 });
    d.remember("a");
    d.remember("b");
    clock.advance(3);
    expect(d.remember("a")).toEqual({
      inserted: false,
      refreshed: true,
      evicted: null,
    });
    // a expires at 3+5=8, b at 5
    clock.advance(2);
    expect(d.expireNow()).toEqual(["b"]);
    expect(d.seen("a")).toBe(true);
    expect(d.keys()).toEqual(["a"]);
  });

  test("expire via tick", () => {
    const { d } = make({ ttl: 3 });
    d.remember("x");
    expect(d.tick()).toEqual([]);
    expect(d.tick()).toEqual([]);
    expect(d.tick()).toEqual(["x"]);
    expect(d.seen("x")).toBe(false);
  });

  test("capacity evicts earliest expiry", () => {
    const { clock, d } = make({ ttl: 10, capacity: 2 });
    d.remember("a");
    clock.advance(1);
    d.remember("b");
    clock.advance(1);
    const r = d.remember("c");
    expect(r.inserted).toBe(true);
    expect(r.evicted).toBe("a");
    expect(d.keys()).toEqual(["b", "c"]);
  });

  test("capacity eviction tie breaks by seq", () => {
    const { d } = make({ ttl: 10, capacity: 2 });
    d.remember("a");
    d.remember("b");
    // same expireAt; seq a < b → evict a
    expect(d.remember("c").evicted).toBe("a");
    expect(d.keys()).toEqual(["b", "c"]);
  });

  test("forget removes", () => {
    const { d } = make();
    d.remember("z");
    expect(d.forget("z")).toBe(true);
    expect(d.forget("z")).toBe(false);
    expect(d.seen("z")).toBe(false);
  });

  test("empty key throws", () => {
    const { d } = make();
    expect(() => d.remember("")).toThrow(InvalidKeyError);
    expect(() => d.seen("")).toThrow(InvalidKeyError);
    expect(() => d.forget("")).toThrow(InvalidKeyError);
  });

  test("invalid config throws", () => {
    const clock = new VirtualClock();
    expect(() => new DedupTtl({ clock, ttl: 0 })).toThrow(InvalidConfigError);
    expect(() => new DedupTtl({ clock, capacity: -1 })).toThrow(InvalidConfigError);
  });

  test("lazy expire before remember frees capacity", () => {
    const { clock, d } = make({ ttl: 2, capacity: 1 });
    d.remember("old");
    clock.advance(2);
    const r = d.remember("new");
    expect(r.evicted).toBe(null);
    expect(r.inserted).toBe(true);
    expect(d.keys()).toEqual(["new"]);
  });

  test("expireNow batch order by expireAt then key", () => {
    const { clock, d } = make({ ttl: 5 });
    d.remember("b");
    d.remember("a");
    clock.advance(5);
    expect(d.expireNow()).toEqual(["a", "b"]);
  });

  test("different expireAt order", () => {
    const { clock, d } = make({ ttl: 10 });
    d.remember("late");
    clock.advance(3);
    d.remember("early");
    // late expires at 10, early at 13
    clock.advance(7);
    expect(d.expireNow()).toEqual(["late"]);
    expect(d.keys()).toEqual(["early"]);
  });

  test("size after silent time pass needs expire", () => {
    const { clock, d } = make({ ttl: 2 });
    d.remember("k");
    clock.advance(2);
    expect(d.size()).toBe(0);
  });

  test("keys follow insert seq", () => {
    const { d } = make();
    d.remember("z");
    d.remember("a");
    d.remember("m");
    expect(d.keys()).toEqual(["z", "a", "m"]);
  });

  test("refresh does not get evicted before older peer wrongly", () => {
    const { clock, d } = make({ ttl: 5, capacity: 2 });
    d.remember("a");
    clock.advance(1);
    d.remember("b");
    clock.advance(1);
    d.remember("a"); // refresh a → expireAt=1+1+5=7; b expires at 1+5=6
    clock.advance(4);
    expect(d.expireNow()).toEqual(["b"]);
    expect(d.seen("a")).toBe(true);
  });
});
