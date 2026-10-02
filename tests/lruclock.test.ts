import {
  ClockCache,
  ClockError,
  ExactCache,
  ExactError,
  copyFrames,
  emptyFrame,
} from "../src/index.js";

describe("lruclock base ExactCache", () => {
  test("put and get", () => {
    const c = new ExactCache(2);
    c.put("a", 1);
    c.put("b", 2);
    expect(c.get("a")).toBe(1);
    expect(c.get("b")).toBe(2);
  });

  test("has reports membership", () => {
    const c = new ExactCache(3);
    c.put("x", 10);
    expect(c.has("x")).toBe(true);
    expect(c.has("y")).toBe(false);
  });

  test("size counts entries", () => {
    const c = new ExactCache(5);
    c.put("a", 1);
    c.put("b", 2);
    expect(c.size()).toBe(2);
  });

  test("keys returns sorted ascending", () => {
    const c = new ExactCache(4);
    c.put("z", 1);
    c.put("a", 2);
    c.put("m", 3);
    expect(c.keys()).toEqual(["a", "m", "z"]);
  });

  test("update existing key does not evict", () => {
    const c = new ExactCache(2);
    c.put("a", 1);
    c.put("b", 2);
    c.put("a", 9);
    expect(c.size()).toBe(2);
    expect(c.get("b")).toBe(2);
    expect(c.get("a")).toBe(9);
  });

  test("full put evicts lexicographically largest key", () => {
    const c = new ExactCache(2);
    c.put("a", 1);
    c.put("z", 2);
    c.put("m", 3);
    expect(c.has("z")).toBe(false);
    expect(c.keys()).toEqual(["a", "m"]);
  });

  test("clear empties cache", () => {
    const c = new ExactCache(3);
    c.put("a", 1);
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.keys()).toEqual([]);
  });

  test("ExactError on invalid capacity", () => {
    expect(() => new ExactCache(0)).toThrow(ExactError);
    expect(() => new ExactCache(-1)).toThrow(ExactError);
  });
});

describe("lruclock feature hell", () => {
  test("ClockError on invalid capacity", () => {
    expect(() => new ClockCache(0)).toThrow(ClockError);
    expect(() => new ClockCache(4097)).toThrow(ClockError);
  });

  test("emptyFrame and copyFrames helpers", () => {
    const f = emptyFrame();
    expect(f).toEqual({ key: null, value: 0, ref: false });
    const frames = [
      { key: "a", value: 1, ref: true },
      { key: null, value: 0, ref: false },
    ];
    const copy = copyFrames(frames);
    expect(copy).toEqual(frames);
    copy[0]!.ref = false;
    expect(frames[0]!.ref).toBe(true);
  });

  test("put fills free slot clockwise from hand", () => {
    const cc = new ClockCache(4);
    cc.put("a", 1);
    cc.put("b", 2);
    cc.put("c", 3);
    expect(cc.size()).toBe(3);
    expect(cc.handPosition()).toBe(3);
    cc.put("d", 4);
    expect(cc.size()).toBe(4);
    expect(cc.handPosition()).toBe(0);
  });

  test("put existing key updates value sets ref without moving hand", () => {
    const cc = new ClockCache(3);
    cc.put("a", 1);
    cc.put("b", 2);
    const handBefore = cc.handPosition();
    cc.put("a", 99);
    expect(cc.peek("a")).toBe(99);
    expect(cc.handPosition()).toBe(handBefore);
  });

  test("get sets ref bit and does not move hand", () => {
    const cc = new ClockCache(2);
    cc.put("a", 1);
    cc.put("b", 2);
    const handBefore = cc.handPosition();
    expect(cc.get("a")).toBe(1);
    expect(cc.handPosition()).toBe(handBefore);
    expect(cc.frames()[0]!.ref).toBe(true);
  });

  test("get miss returns undefined", () => {
    const cc = new ClockCache(2);
    cc.put("only", 7);
    expect(cc.get("missing")).toBeUndefined();
  });

  test("peek reads without setting ref", () => {
    const cc = ClockCache.fromState({
      capacity: 2,
      hand: 0,
      frames: [
        { key: "a", value: 1, ref: true },
        { key: "b", value: 2, ref: false },
      ],
    });
    expect(cc.peek("b")).toBe(2);
    expect(cc.frames().find((f) => f.key === "b")!.ref).toBe(false);
    expect(cc.frames().find((f) => f.key === "a")!.ref).toBe(true);
  });

  test("clock eviction gives second chance then replaces", () => {
    const cc = new ClockCache(2);
    cc.put("a", 1);
    cc.put("b", 2);
    cc.get("a");
    cc.put("c", 3);
    expect(cc.has("a")).toBe(false);
    expect(cc.has("b")).toBe(true);
    expect(cc.get("c")).toBe(3);
  });

  test("clock eviction clears refs then replaces at hand", () => {
    const cc = new ClockCache(3);
    cc.put("a", 1);
    cc.put("b", 2);
    cc.put("c", 3);
    cc.get("a");
    cc.get("b");
    cc.put("d", 4);
    expect(cc.has("a")).toBe(false);
    expect(cc.has("b")).toBe(true);
    expect(cc.has("c")).toBe(true);
    expect(cc.get("d")).toBe(4);
    expect(cc.frames().find((f) => f.key === "b")!.ref).toBe(false);
    expect(cc.frames().find((f) => f.key === "c")!.ref).toBe(false);
  });

  test("has and size count occupied frames", () => {
    const cc = new ClockCache(5);
    cc.put("p", 1);
    cc.put("q", 2);
    expect(cc.has("p")).toBe(true);
    expect(cc.has("z")).toBe(false);
    expect(cc.size()).toBe(2);
  });

  test("frames returns copy with empty slots normalized", () => {
    const cc = new ClockCache(3);
    cc.put("x", 10);
    const fr = cc.frames();
    expect(fr).toHaveLength(3);
    expect(fr.filter((f) => f.key !== null)).toHaveLength(1);
    fr[0]!.ref = false;
    expect(cc.frames()[0]!.ref).not.toBe(false);
  });

  test("handPosition tracks eviction pointer", () => {
    const cc = new ClockCache(2);
    expect(cc.handPosition()).toBe(0);
    cc.put("a", 1);
    expect(cc.handPosition()).toBe(1);
    cc.put("b", 2);
    expect(cc.handPosition()).toBe(0);
  });

  test("exportState fromState roundtrip preserves behavior", () => {
    const cc = new ClockCache(3);
    cc.put("a", 1);
    cc.put("b", 2);
    cc.get("a");
    const state = cc.exportState();
    const cc2 = ClockCache.fromState(state);
    expect(cc2.exportState()).toEqual(state);
    expect(cc2.get("a")).toBe(1);
    cc2.put("c", 3);
    expect(cc2.has("c")).toBe(true);
  });

  test("freeze blocks put", () => {
    const cc = new ClockCache(2);
    cc.put("k", 1);
    cc.freeze();
    expect(() => cc.put("k", 2)).toThrow(ClockError);
    expect(() => cc.put("new", 9)).toThrow(ClockError);
  });

  test("stats reflects capacity frozen size hand", () => {
    const cc = new ClockCache(4);
    cc.put("a", 1);
    cc.put("b", 2);
    cc.freeze();
    const st = cc.stats();
    expect(st.capacity).toBe(4);
    expect(st.frozen).toBe(true);
    expect(st.size).toBe(2);
    expect(st.hand).toBe(cc.handPosition());
  });

  test("deterministic multi-step clock sequence", () => {
    const cc = new ClockCache(3);
    cc.put("k1", 10);
    cc.put("k2", 20);
    cc.put("k3", 30);
    cc.put("k4", 40);
    cc.put("k5", 50);
    expect(cc.size()).toBe(3);
    expect(cc.has("k1")).toBe(false);
    expect(cc.has("k2")).toBe(false);
    expect(cc.has("k3")).toBe(true);
    expect(cc.has("k4")).toBe(true);
    expect(cc.has("k5")).toBe(true);
  });

  test("fromState rejects frame length mismatch", () => {
    expect(() =>
      ClockCache.fromState({
        capacity: 2,
        hand: 0,
        frames: [{ key: "a", value: 1, ref: false }],
      }),
    ).toThrow(ClockError);
  });

  test("put after partial fill uses next free slot from hand", () => {
    const cc = ClockCache.fromState({
      capacity: 4,
      hand: 2,
      frames: [
        { key: "a", value: 1, ref: false },
        { key: "b", value: 2, ref: false },
        { key: null, value: 0, ref: false },
        { key: null, value: 0, ref: false },
      ],
    });
    cc.put("c", 3);
    expect(cc.has("c")).toBe(true);
    expect(cc.handPosition()).toBe(3);
  });
});
