import {
  VirtualClock,
  TtlMap,
  InvalidConfigError,
  InvalidKeyError,
  CasError,
} from "../src/index.js";

function m(
  o: Partial<{
    capacity: number;
    defaultTtlMs: number;
    tombstoneTtlMs: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const map = new TtlMap({
    clock,
    capacity: o.capacity ?? 3,
    defaultTtlMs: o.defaultTtlMs ?? 10,
    tombstoneTtlMs: o.tombstoneTtlMs ?? 5,
  });
  return { clock, map };
}

describe("ttlmap hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new TtlMap({ clock, capacity: 0, defaultTtlMs: 1 }),
    ).toThrow(InvalidConfigError);
  });

  test("set get has gen", () => {
    const { map } = m();
    expect(map.set("a", "1")).toEqual({ gen: 1 });
    expect(map.get("a")).toEqual({ value: "1", gen: 1 });
    expect(map.has("a")).toBe(true);
    expect(map.set("a", "2")).toEqual({ gen: 2 });
    expect(map.get("a")!.gen).toBe(2);
  });

  test("lazy expire on get", () => {
    const { clock, map } = m({ defaultTtlMs: 5 });
    map.set("a", "x");
    clock.advance(5);
    expect(map.get("a")).toBeUndefined();
    expect(map.size()).toBe(0);
  });

  test("drive expires multiple keys sorted", () => {
    const { clock, map } = m({ defaultTtlMs: 3 });
    map.set("b", "1");
    map.set("a", "2", { ttlMs: 4 });
    clock.advance(3);
    expect(map.drive()).toEqual(["b"]);
    expect(map.keys()).toEqual(["a"]);
    clock.advance(1);
    expect(map.drive()).toEqual(["a"]);
  });

  test("delete creates tombstone; blocks cas expecting old live", () => {
    const { clock, map } = m({ tombstoneTtlMs: 10 });
    map.set("a", "v");
    expect(map.delete("a")).toBe(true);
    expect(map.get("a")).toBeUndefined();
    expect(map.genOf("a")).toBe(2);
    expect(() => map.cas("a", 1, "z")).toThrow(CasError);
    expect(() => map.cas("a", 2, "z")).toThrow(CasError);
    expect(map.set("a", "n")).toEqual({ gen: 3 });
    clock.advance(10);
  });

  test("cas success and fail", () => {
    const { map } = m();
    map.set("a", "1");
    expect(map.cas("a", 1, "2")).toEqual({ gen: 2 });
    expect(() => map.cas("a", 1, "3")).toThrow(CasError);
    expect(map.get("a")).toEqual({ value: "2", gen: 2 });
  });

  test("capacity eviction by earliest expireAt then key", () => {
    const { clock, map } = m({ capacity: 2, defaultTtlMs: 100 });
    map.set("b", "1", { ttlMs: 50 });
    map.set("a", "2", { ttlMs: 50 });
    // both expireAt=50; evict key "a" (dict smaller) when inserting c
    map.set("c", "3", { ttlMs: 80 });
    expect(map.keys()).toEqual(["b", "c"]);
    expect(map.get("a")).toBeUndefined();
    clock.advance(0);
  });

  test("capacity prefers sweeping expired before eviction", () => {
    const { clock, map } = m({ capacity: 2, defaultTtlMs: 5 });
    map.set("a", "1");
    map.set("b", "2");
    clock.advance(5);
    map.set("c", "3");
    expect(map.keys()).toEqual(["c"]);
  });

  test("inplace update does not evict others at capacity", () => {
    const { map } = m({ capacity: 2, defaultTtlMs: 100 });
    map.set("a", "1");
    map.set("b", "2");
    expect(map.set("a", "1b")).toEqual({ gen: 2 });
    expect(map.keys()).toEqual(["a", "b"]);
  });

  test("tombstone counts toward capacity", () => {
    const { map } = m({ capacity: 2, defaultTtlMs: 100, tombstoneTtlMs: 100 });
    map.set("a", "1");
    map.delete("a");
    map.set("b", "2");
    // full: tomb a + live b; insert c evicts earliest expire — both 100, key a < b
    map.set("c", "3");
    expect(map.keys().sort()).toEqual(["b", "c"]);
  });

  test("invalid key", () => {
    const { map } = m();
    expect(() => map.set("", "x")).toThrow(InvalidKeyError);
    expect(() => map.get("")).toThrow(InvalidKeyError);
  });

  test("delete missing false; delete tomb false", () => {
    const { map } = m();
    expect(map.delete("no")).toBe(false);
    map.set("a", "1");
    map.delete("a");
    expect(map.delete("a")).toBe(false);
  });

  test("interleaved ttl and cas", () => {
    const { clock, map } = m({ defaultTtlMs: 10, capacity: 3 });
    map.set("x", "1");
    map.set("y", "1", { ttlMs: 5 });
    clock.advance(5);
    expect(map.has("y")).toBe(false);
    expect(map.cas("x", 1, "2", { ttlMs: 3 })).toEqual({ gen: 2 });
    clock.advance(3);
    expect(map.drive()).toEqual(["x"]);
    expect(map.size()).toBe(0);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("expectGen on set", () => {
    const { map } = m();
    map.set("a", "1");
    expect(() => map.set("a", "2", { expectGen: 9 })).toThrow(CasError);
    expect(map.set("a", "2", { expectGen: 1 })).toEqual({ gen: 2 });
  });
});
