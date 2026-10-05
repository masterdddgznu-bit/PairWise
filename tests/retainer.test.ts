import {
  VirtualClock,
  Retainer,
  InvalidConfigError,
  InvalidKeyError,
  CapacityError,
  PinError,
  BudgetError,
} from "../src/index.js";

describe("retainer hell", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Retainer({ clock, ttlMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new Retainer({ clock, ttlMs: 1, maxKeys: 0 })).toThrow(InvalidConfigError);
    expect(() => new Retainer({ clock, ttlMs: 1, initialCredits: -1 })).toThrow(InvalidConfigError);
  });

  test("hold/get/claim with budget", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 10, maxKeys: 4, initialCredits: 1 });
    expect(r.hold("a", 1).status).toBe("accepted");
    expect(r.get("a")).toBe(1);
    expect(r.claim("a")).toEqual({ payload: 1 });
    expect(r.credits()).toBe(0);
    expect(r.get("a")).toBeUndefined();
  });

  test("claim without credit throws and keeps entry", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 10, maxKeys: 4 });
    r.hold("a", 1);
    expect(() => r.claim("a")).toThrow(BudgetError);
    expect(r.get("a")).toBe(1);
    expect(r.size()).toBe(1);
    r.grant(2);
    expect(r.claim("a")).toEqual({ payload: 1 });
    expect(r.credits()).toBe(1);
  });

  test("update preserves first-hold order and refreshes ttl", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 10, maxKeys: 4 });
    r.hold("a", 1);
    r.hold("b", 2);
    clock.advance(3);
    expect(r.hold("a", 9).status).toBe("updated");
    expect(r.keys()).toEqual(["a", "b"]);
    expect(r.deadlineOf("a")).toBe(13);
  });

  test("capacity counts registered; cancel frees", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 100, maxKeys: 2 });
    r.hold("a", 1);
    r.hold("b", 2);
    expect(() => r.hold("c", 3)).toThrow(CapacityError);
    expect(r.cancel("a")).toBe(true);
    expect(r.hold("c", 3).status).toBe("accepted");
  });

  test("lazy expire on get/hold for unpinned only", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 5, maxKeys: 4 });
    r.hold("a", 1);
    clock.advance(5);
    expect(r.get("a")).toBeUndefined();
    expect(r.size()).toBe(0);
    r.hold("b", 2);
    clock.advance(5);
    expect(r.hold("b", 3).status).toBe("accepted");
    expect(r.get("b")).toBe(3);
  });

  test("drive clears unpinned expired in first-hold order", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 5, maxKeys: 8 });
    r.hold("a", 1);
    r.hold("b", 2);
    r.hold("c", 3);
    clock.advance(5);
    expect(r.drive().expired).toEqual(["a", "b", "c"]);
    expect(r.size()).toBe(0);
  });

  test("pin blocks claim and expire; get still sees past-deadline", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 5, maxKeys: 4, initialCredits: 3 });
    r.hold("a", 1);
    expect(r.pin("a")).toBe(true);
    expect(r.isPinned("a")).toBe(true);
    clock.advance(5);
    expect(r.drive().expired).toEqual([]);
    expect(r.get("a")).toBe(1);
    expect(() => r.claim("a")).toThrow(PinError);
    expect(r.credits()).toBe(3);
  });

  test("unpin of expired purges immediately", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 5, maxKeys: 4 });
    r.hold("a", 1);
    r.pin("a");
    clock.advance(5);
    expect(r.unpin("a")).toBe(true);
    expect(r.size()).toBe(0);
    expect(r.isPinned("a")).toBe(false);
  });

  test("hold refresh on pinned expired keeps pin and capacity slot", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 5, maxKeys: 1 });
    r.hold("a", 1);
    r.pin("a");
    clock.advance(5);
    expect(r.hold("a", 2).status).toBe("updated");
    expect(r.deadlineOf("a")).toBe(10);
    expect(r.isPinned("a")).toBe(true);
    expect(() => r.hold("b", 3)).toThrow(CapacityError);
  });

  test("invalid keys and bad grant", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 5, maxKeys: 2 });
    expect(() => r.hold("", 1)).toThrow(InvalidKeyError);
    expect(() => r.claim("")).toThrow(InvalidKeyError);
    expect(() => r.pin("")).toThrow(InvalidKeyError);
    expect(() => r.grant(-1)).toThrow(BudgetError);
    expect(r.credits()).toBe(0);
  });

  test("interleaved: pin protect while neighbor drive-expires", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 10, maxKeys: 4, initialCredits: 2 });
    r.hold("a", 1);
    r.hold("b", 2);
    r.pin("a");
    clock.advance(10);
    expect(r.drive().expired).toEqual(["b"]);
    expect(r.keys()).toEqual(["a"]);
    expect(r.get("a")).toBe(1);
    r.unpin("a");
    expect(r.size()).toBe(0);
  });

  test("interleaved: budget gate across multiple claims", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 50, maxKeys: 4, initialCredits: 1 });
    r.hold("x", "X");
    r.hold("y", "Y");
    expect(r.claim("x")).toEqual({ payload: "X" });
    expect(() => r.claim("y")).toThrow(BudgetError);
    r.grant(1);
    expect(r.claim("y")).toEqual({ payload: "Y" });
  });

  test("interleaved: cancel pinned frees capacity for new hold", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 20, maxKeys: 1 });
    r.hold("a", 1);
    r.pin("a");
    clock.advance(20);
    expect(() => r.hold("b", 2)).toThrow(CapacityError);
    expect(r.cancel("a")).toBe(true);
    expect(r.hold("b", 2).status).toBe("accepted");
  });

  test("interleaved: claim null on missing does not spend", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 5, maxKeys: 2, initialCredits: 2 });
    expect(r.claim("nope")).toBeNull();
    expect(r.credits()).toBe(2);
    r.hold("a", 1);
    clock.advance(5);
    expect(r.claim("a")).toBeNull();
    expect(r.credits()).toBe(2);
  });

  test("interleaved: pin then update then claim after unpin spends once", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 10, maxKeys: 2, initialCredits: 1 });
    r.hold("k", "old");
    r.pin("k");
    clock.advance(4);
    r.hold("k", "new");
    expect(() => r.claim("k")).toThrow(PinError);
    expect(r.unpin("k")).toBe(true);
    expect(r.claim("k")).toEqual({ payload: "new" });
    expect(r.credits()).toBe(0);
    expect(r.size()).toBe(0);
  });

  test("keys may list pinned-expired until unpin/drive-cannot", () => {
    const clock = new VirtualClock();
    const r = new Retainer({ clock, ttlMs: 3, maxKeys: 2 });
    r.hold("p", 1);
    r.pin("p");
    clock.advance(3);
    expect(r.keys()).toEqual(["p"]);
    expect(r.deadlineOf("p")).toBe(3);
    expect(r.drive().expired).toEqual([]);
    expect(r.size()).toBe(1);
  });
});
