import {
  GenError,
  GenHub,
  LocalCache,
  StaleGenError,
  VirtualClock,
} from "../src/index.js";

describe("geninv base LocalCache", () => {
  test("put and get", () => {
    const c = new LocalCache();
    c.put("a", "1");
    expect(c.get("a")).toBe("1");
  });

  test("delete returns bool", () => {
    const c = new LocalCache();
    c.put("x", "v");
    expect(c.delete("x")).toBe(true);
    expect(c.delete("x")).toBe(false);
  });

  test("has reflects presence", () => {
    const c = new LocalCache();
    c.put("k", "v");
    expect(c.has("k")).toBe(true);
    expect(c.has("missing")).toBe(false);
  });

  test("keys sorted", () => {
    const c = new LocalCache();
    c.put("c", "3");
    c.put("a", "1");
    c.put("b", "2");
    expect(c.keys()).toEqual(["a", "b", "c"]);
  });

  test("size tracks entries", () => {
    const c = new LocalCache();
    c.put("a", "1");
    c.put("b", "2");
    expect(c.size()).toBe(2);
  });

  test("empty cache", () => {
    const c = new LocalCache();
    expect(c.keys()).toEqual([]);
    expect(c.size()).toBe(0);
  });
});

describe("geninv feature hell", () => {
  test("put and get at generation zero", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s1", "s2"]);
    hub.put("s1", "k", "v", 0);
    expect(hub.get("s1", "k")).toBe("v");
    expect(hub.generation()).toBe(0);
  });

  test("eager invalidate wipes all shards immediately", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["a", "b"]);
    hub.put("a", "k", "va", 0);
    hub.put("b", "k", "vb", 0);
    const g = hub.invalidate("k", "eager");
    expect(g).toBe(1);
    expect(hub.get("a", "k")).toBeUndefined();
    expect(hub.get("b", "k")).toBeUndefined();
    expect(hub.shardGen("a")).toBe(1);
    expect(hub.shardGen("b")).toBe(1);
  });

  test("lazy invalidate keeps value until catchUp", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["x", "y"]);
    hub.put("x", "k", "vx", 0);
    hub.put("y", "k", "vy", 0);
    hub.invalidate("k", "lazy");
    expect(hub.pendingCount("x")).toBe(1);
    expect(hub.pendingCount("y")).toBe(1);
    expect(hub.shardGen("x")).toBe(0);
    expect(hub.shardGen("y")).toBe(0);
    expect(hub.catchUp("x")).toBe(1);
    expect(hub.get("x", "k")).toBeUndefined();
    expect(hub.shardGen("y")).toBe(0);
    expect(hub.pendingCount("y")).toBe(1);
    expect(hub.catchUp("y")).toBe(1);
    expect(hub.get("y", "k")).toBeUndefined();
  });

  test("get applies lazy invalidation", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    hub.put("s", "key", "val", 0);
    hub.invalidate("key", "lazy");
    expect(hub.get("s", "key")).toBeUndefined();
    expect(hub.shardGen("s")).toBe(1);
  });

  test("stale put rejected on wrong generation", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    hub.put("s", "a", "1", 0);
    hub.invalidate("a", "eager");
    expect(() => hub.put("s", "b", "2", 0)).toThrow(StaleGenError);
    expect(hub.stats().stalePutRejections).toBe(1);
  });

  test("stale put rejected when shard not caught up", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["fast", "slow"]);
    hub.put("fast", "k", "v", 0);
    hub.put("slow", "k", "v", 0);
    hub.invalidate("other", "lazy");
    hub.catchUp("fast");
    expect(hub.shardGen("fast")).toBe(1);
    expect(hub.shardGen("slow")).toBe(0);
    expect(() => hub.put("slow", "k", "new", 1)).toThrow(StaleGenError);
    expect(hub.stats().stalePutRejections).toBe(1);
  });

  test("put succeeds after catchUp at current gen", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    hub.invalidate("x", "lazy");
    hub.catchUp("s");
    hub.put("s", "y", "ok", 1);
    expect(hub.get("s", "y")).toBe("ok");
  });

  test("pendingCount tracks lagging shard", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["a", "b"]);
    hub.invalidate("k1", "lazy");
    hub.invalidate("k2", "lazy");
    hub.catchUp("a");
    expect(hub.pendingCount("a")).toBe(0);
    expect(hub.pendingCount("b")).toBe(2);
  });

  test("multi-shard lag independent catchUp", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["p", "q"]);
    hub.put("p", "k", "vp", 0);
    hub.put("q", "k", "vq", 0);
    hub.invalidate("k", "lazy");
    expect(hub.get("p", "k")).toBeUndefined();
    expect(hub.shardGen("p")).toBe(1);
    expect(hub.shardGen("q")).toBe(0);
    expect(hub.pendingCount("q")).toBe(1);
    hub.catchUp("q");
    expect(hub.get("q", "k")).toBeUndefined();
  });

  test("generation bumps on each invalidate", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    expect(hub.generation()).toBe(0);
    hub.invalidate("a", "eager");
    expect(hub.generation()).toBe(1);
    hub.invalidate("b", "lazy");
    expect(hub.generation()).toBe(2);
  });

  test("reap drops fully applied old records", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    hub.invalidate("a", "eager");
    hub.catchUp("s");
    clock.advance(100);
    expect(hub.reap(50)).toBe(1);
    expect(hub.stats().pendingInvs).toBe(0);
  });

  test("reap keeps records not yet applied everywhere", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["a", "b"]);
    hub.invalidate("k", "lazy");
    hub.catchUp("a");
    clock.advance(200);
    expect(hub.reap(100)).toBe(0);
    expect(hub.stats().pendingInvs).toBe(1);
  });

  test("reap keeps young records even if applied", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    hub.invalidate("k", "eager");
    expect(hub.reap(1000)).toBe(0);
    expect(hub.stats().pendingInvs).toBe(1);
  });

  test("stats reflects globalGen and queue size", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    hub.invalidate("a", "lazy");
    hub.invalidate("b", "lazy");
    const st = hub.stats();
    expect(st.globalGen).toBe(2);
    expect(st.pendingInvs).toBe(2);
    expect(st.stalePutRejections).toBe(0);
  });

  test("unknown shard throws GenError", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    expect(() => hub.get("z", "k")).toThrow(GenError);
    expect(() => hub.put("z", "k", "v", 0)).toThrow(GenError);
  });

  test("duplicate shard id throws GenError", () => {
    const clock = new VirtualClock();
    expect(() => new GenHub(clock, ["a", "a"])).toThrow(GenError);
  });

  test("sequential eager then lazy invalidations", () => {
    const clock = new VirtualClock();
    const hub = new GenHub(clock, ["s"]);
    hub.put("s", "a", "1", 0);
    hub.put("s", "b", "2", 0);
    hub.invalidate("a", "eager");
    hub.put("s", "c", "3", 1);
    hub.invalidate("b", "lazy");
    expect(hub.get("s", "a")).toBeUndefined();
    expect(hub.get("s", "c")).toBe("3");
    expect(hub.get("s", "b")).toBeUndefined();
    expect(hub.generation()).toBe(2);
  });
});
