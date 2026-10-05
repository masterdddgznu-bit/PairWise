import {
  AgeEvict,
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
  VirtualClock,
} from "../src/index.js";

describe("ageevict hell 0-1", () => {
  test("rejects invalid config and keys", () => {
    const clock = new VirtualClock();
    expect(() => new AgeEvict({ clock, ttlMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new AgeEvict({ clock, ttlMs: 1, maxItems: 0 })).toThrow(
      InvalidConfigError,
    );
    const m = new AgeEvict({ clock, ttlMs: 10, maxItems: 2 });
    expect(() => m.set("", 1)).toThrow(InvalidKeyError);
    expect(() => m.get("")).toThrow(InvalidKeyError);
    expect(() => m.pin("")).toThrow(InvalidKeyError);
  });

  test("set/get basic; update refreshes ttl and lru", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 10, maxItems: 4 });
    expect(m.set("a", 1).status).toBe("accepted");
    expect(m.set("b", 2).status).toBe("accepted");
    clock.advance(5);
    expect(m.set("a", 9).status).toBe("updated");
    expect(m.deadlineOf("a")).toBe(15);
    expect(m.keys()).toEqual(["b", "a"]);
    expect(m.get("a")).toBe(9);
  });

  test("get refreshes LRU touch but not deadline", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 20, maxItems: 4 });
    m.set("a", 1);
    m.set("b", 2);
    clock.advance(5);
    expect(m.get("a")).toBe(1);
    expect(m.touchedAtOf("a")).toBe(5);
    expect(m.deadlineOf("a")).toBe(20);
    expect(m.keys()).toEqual(["b", "a"]);
  });

  test("get lazy-deletes expired; now===deadline expired", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 5, maxItems: 4 });
    m.set("a", 1);
    clock.advance(5);
    expect(m.get("a")).toBeUndefined();
    expect(m.size()).toBe(0);
    m.set("b", 2);
    clock.advance(5);
    expect(m.drive().expired).toEqual(["b"]);
  });

  test("full set purges expired before LRU eviction", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 10, maxItems: 2 });
    m.set("a", 1);
    m.set("b", 2);
    clock.advance(10);
    const r = m.set("c", 3);
    expect(r.status).toBe("accepted");
    expect(r.evicted ?? []).toEqual(["a", "b"]);
    expect(m.keys()).toEqual(["c"]);
  });

  test("full set with no expired evicts LRU oldest unpinned", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 100, maxItems: 2 });
    m.set("a", 1);
    clock.advance(1);
    m.set("b", 2);
    clock.advance(1);
    m.get("a");
    const r = m.set("c", 3);
    expect(r.status).toBe("accepted");
    expect(r.evicted ?? []).toEqual(["b"]);
    expect(m.keys()).toEqual(["a", "c"]);
  });

  test("pinned key skipped by LRU; CapacityError when only pinned remain", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 100, maxItems: 2 });
    m.set("a", 1);
    m.set("b", 2);
    expect(m.pin("a")).toBe(true);
    expect(m.pin("b")).toBe(true);
    expect(m.isPinned("a")).toBe(true);
    expect(() => m.set("c", 3)).toThrow(CapacityError);
    expect(m.size()).toBe(2);
  });

  test("pinned still TTL-expires on drive and get", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 5, maxItems: 4 });
    m.set("a", 1);
    m.pin("a");
    clock.advance(5);
    expect(m.drive().expired).toEqual(["a"]);
    expect(m.isPinned("a")).toBe(false);
    m.set("b", 2);
    m.pin("b");
    clock.advance(5);
    expect(m.get("b")).toBeUndefined();
  });

  test("pin protects while unpinned neighbor is LRU victim", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 100, maxItems: 2 });
    m.set("a", 1);
    m.set("b", 2);
    m.pin("a");
    // touch order a,b; a pinned → victim b
    const r = m.set("c", 3);
    expect(r.evicted ?? []).toEqual(["b"]);
    expect(m.keys()).toEqual(["a", "c"]);
    expect(m.isPinned("a")).toBe(true);
  });

  test("update existing when full does not evict; pin survives update", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 50, maxItems: 2 });
    m.set("a", 1);
    m.set("b", 2);
    m.pin("a");
    expect(m.set("a", 9)).toEqual({ status: "updated" });
    expect(m.isPinned("a")).toBe(true);
    expect(m.size()).toBe(2);
  });

  test("set does not purge expired when not full", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 5, maxItems: 4 });
    m.set("a", 1);
    clock.advance(5);
    m.set("b", 2);
    expect(m.size()).toBe(2);
    expect(m.keys()).toEqual(["a", "b"]);
    expect(m.drive().expired).toEqual(["a"]);
  });

  test("delete removes even if expired; unpin/pin edge cases", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 3, maxItems: 4 });
    m.set("a", 1);
    expect(m.pin("missing")).toBe(false);
    expect(m.unpin("missing")).toBe(false);
    m.pin("a");
    clock.advance(3);
    expect(m.delete("a")).toBe(true);
    expect(m.delete("a")).toBe(false);
    expect(m.isPinned("a")).toBe(false);
  });

  test("drive expires in LRU oldest-to-newest order including pins", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 10, maxItems: 8 });
    m.set("a", 1);
    clock.advance(1);
    m.set("b", 2);
    clock.advance(1);
    m.set("c", 3);
    m.get("a");
    m.pin("b");
    clock.advance(10);
    expect(m.drive().expired).toEqual(["b", "c", "a"]);
  });

  test("interleaved pin get set eviction and ttl", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 10, maxItems: 3 });
    m.set("a", 1);
    m.set("b", 2);
    m.set("c", 3);
    m.pin("c");
    clock.advance(5);
    expect(m.get("a")).toBe(1);
    m.set("b", 20);
    // touch: c, a, b; c pinned
    clock.advance(5);
    // now=10; a,c expired; b live deadline 15
    const r = m.set("d", 4);
    expect(r.evicted ?? []).toEqual(["c", "a"]);
    expect(m.keys()).toEqual(["b", "d"]);
    expect(m.get("b")).toBe(20);
  });

  test("interleaved capacity wall then unpin frees LRU path", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 100, maxItems: 2 });
    m.set("a", 1);
    m.set("b", 2);
    m.pin("a");
    m.pin("b");
    expect(() => m.set("c", 3)).toThrow(CapacityError);
    expect(m.unpin("a")).toBe(true);
    const r = m.set("c", 3);
    expect(r.evicted ?? []).toEqual(["a"]);
    expect(m.keys()).toEqual(["b", "c"]);
    expect(m.isPinned("b")).toBe(true);
  });

  test("interleaved drive after pin and partial refresh", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 8, maxItems: 4 });
    m.set("x", 1);
    m.set("y", 2);
    m.pin("x");
    clock.advance(4);
    m.set("y", 9); // y deadline 12
    clock.advance(4); // now=8; x expired, y live
    expect(m.drive().expired).toEqual(["x"]);
    expect(m.keys()).toEqual(["y"]);
    expect(m.get("y")).toBe(9);
  });

  test("default maxItems 16", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 100 });
    for (let i = 0; i < 16; i++) m.set(`k${i}`, i);
    const r = m.set("x", 1);
    expect(r.status).toBe("accepted");
    expect(r.evicted ?? []).toEqual(["k0"]);
    expect(m.size()).toBe(16);
  });

  test("expired key set is updated; keeps pin", () => {
    const clock = new VirtualClock();
    const m = new AgeEvict({ clock, ttlMs: 5, maxItems: 2 });
    m.set("a", 1);
    m.pin("a");
    clock.advance(5);
    expect(m.set("a", 2)).toEqual({ status: "updated" });
    expect(m.isPinned("a")).toBe(true);
    expect(m.get("a")).toBe(2);
  });
});
