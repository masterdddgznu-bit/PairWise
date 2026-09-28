import {
  FencedStore,
  LeaseHeldError,
  StaleFenceError,
  VirtualClock,
} from "../src/index.js";

function feat() {
  const clock = new VirtualClock();
  const store = new FencedStore(clock);
  return { clock, store };
}

describe("fencekv base", () => {
  test("put get", () => {
    const store = new FencedStore();
    store.put("a", "1");
    expect(store.get("a")).toBe("1");
  });

  test("delete has size", () => {
    const store = new FencedStore();
    store.put("a", "1");
    expect(store.has("a")).toBe(true);
    expect(store.delete("a")).toBe(true);
    expect(store.size()).toBe(0);
  });

  test("keys sorted", () => {
    const store = new FencedStore();
    store.put("c", "3");
    store.put("a", "1");
    store.put("b", "2");
    expect(store.keys()).toEqual(["a", "b", "c"]);
  });

  test("overwrite", () => {
    const store = new FencedStore();
    store.put("a", "1");
    store.put("a", "2");
    expect(store.get("a")).toBe("2");
    expect(store.size()).toBe(1);
  });

  test("independent keys", () => {
    const store = new FencedStore();
    store.put("a", "1");
    store.put("b", "2");
    store.delete("a");
    expect(store.get("b")).toBe("2");
  });

  test("delete missing", () => {
    const store = new FencedStore();
    expect(store.delete("x")).toBe(false);
  });
});

describe("fencekv feature hell", () => {
  test("acquire grants monotonic fence", () => {
    const { store } = feat();
    const { fence } = store.acquire("h1", 100);
    expect(fence).toBe(1);
    expect(store.currentLease()).toEqual({
      holderId: "h1",
      fence: 1,
      expiresAt: 100,
    });
  });

  test("LeaseHeldError when other holder holds lease", () => {
    const { store } = feat();
    store.acquire("h1", 100);
    expect(() => store.acquire("h2", 50)).toThrow(LeaseHeldError);
  });

  test("renew extends expiry", () => {
    const { clock, store } = feat();
    const { fence } = store.acquire("h1", 100);
    clock.advance(40);
    store.renew("h1", fence, 200);
    expect(store.currentLease()?.expiresAt).toBe(240);
  });

  test("release clears lease", () => {
    const { store } = feat();
    const { fence } = store.acquire("h1", 100);
    store.release("h1", fence);
    expect(store.currentLease()).toBeNull();
  });

  test("fenced put and unfenced read", () => {
    const { store } = feat();
    const { fence } = store.acquire("w", 100);
    store.put("k", "v", fence);
    expect(store.get("k")).toBe("v");
    expect(store.has("k")).toBe(true);
  });

  test("stale put rejected", () => {
    const { store } = feat();
    store.acquire("h1", 100);
    expect(() => store.put("k", "v", 999)).toThrow(StaleFenceError);
  });

  test("expire steal gets higher fence", () => {
    const { clock, store } = feat();
    const a = store.acquire("h1", 50);
    clock.advance(50);
    const b = store.acquire("h2", 50);
    expect(b.fence).toBeGreaterThan(a.fence);
    expect(store.currentLease()?.holderId).toBe("h2");
  });

  test("old holder stale put after steal", () => {
    const { clock, store } = feat();
    const a = store.acquire("h1", 50);
    store.put("k", "old", a.fence);
    clock.advance(50);
    store.acquire("h2", 50);
    expect(() => store.put("k", "new", a.fence)).toThrow(StaleFenceError);
    expect(store.get("k")).toBe("old");
  });

  test("same holder reacquire keeps fence", () => {
    const { store } = feat();
    const a = store.acquire("h1", 100);
    const b = store.acquire("h1", 100);
    expect(b.fence).toBe(a.fence);
  });

  test("renew wrong fence throws", () => {
    const { store } = feat();
    store.acquire("h1", 100);
    expect(() => store.renew("h1", 99, 100)).toThrow(StaleFenceError);
  });

  test("release wrong fence throws", () => {
    const { store } = feat();
    const { fence } = store.acquire("h1", 100);
    expect(() => store.release("h1", fence + 1)).toThrow(StaleFenceError);
    expect(store.currentLease()?.fence).toBe(fence);
  });

  test("renew wrong holder throws LeaseHeldError", () => {
    const { store } = feat();
    const { fence } = store.acquire("h1", 100);
    expect(() => store.renew("h2", fence, 100)).toThrow(LeaseHeldError);
  });

  test("clock advance expires lease", () => {
    const { clock, store } = feat();
    store.acquire("h1", 30);
    clock.advance(30);
    expect(store.currentLease()).toBeNull();
  });

  test("fenced delete", () => {
    const { store } = feat();
    const { fence } = store.acquire("h1", 100);
    store.put("k", "v", fence);
    expect(store.delete("k", fence)).toBe(true);
    expect(store.get("k")).toBeUndefined();
  });

  test("stale delete rejected", () => {
    const { store } = feat();
    store.acquire("h1", 100);
    store.put("k", "v", 1);
    expect(() => store.delete("k", 2)).toThrow(StaleFenceError);
    expect(store.get("k")).toBe("v");
  });

  test("lastWriterFence updated", () => {
    const { store } = feat();
    const { fence } = store.acquire("h1", 100);
    store.put("a", "1", fence);
    expect(store.lastWriterFence()).toBe(fence);
    store.put("b", "2", fence);
    expect(store.lastWriterFence()).toBe(fence);
  });

  test("keys and size unfenced in feature mode", () => {
    const { store } = feat();
    const { fence } = store.acquire("h1", 100);
    store.put("b", "2", fence);
    store.put("a", "1", fence);
    expect(store.keys()).toEqual(["a", "b"]);
    expect(store.size()).toBe(2);
  });
});
