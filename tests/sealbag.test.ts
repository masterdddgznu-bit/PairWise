import {
  VirtualClock,
  SealBag,
  InvalidConfigError,
  InvalidKeyError,
  CapacityError,
  UnknownEpochError,
} from "../src/index.js";

function sb(
  o: Partial<{ idleMs: number; maxOpenKeys: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new SealBag({
    clock,
    idleMs: o.idleMs ?? 5,
    maxOpenKeys: o.maxOpenKeys ?? 4,
  });
  return { clock, n };
}

describe("sealbag hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new SealBag({ clock, idleMs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new SealBag({ clock, idleMs: 1, maxOpenKeys: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("LWW keeps first-insert take order after seal", () => {
    const { n } = sb();
    expect(n.put("b", 1)).toEqual({ epoch: 1, status: "accepted" });
    expect(n.put("a", 1)).toEqual({ epoch: 1, status: "accepted" });
    expect(n.put("b", 9)).toEqual({ epoch: 1, status: "updated" });
    expect(n.openKeys()).toEqual(["b", "a"]);
    expect(n.peekOpen("b")).toBe(9);
    n.seal();
    expect(n.take()).toEqual({ epoch: 1, key: "b", payload: 9 });
    expect(n.take()).toEqual({ epoch: 1, key: "a", payload: 1 });
    expect(n.statusOf(1)).toBe("drained");
  });

  test("cannot take open epoch", () => {
    const { n } = sb();
    n.put("a", 1);
    expect(n.take()).toBeNull();
    expect(n.readyCount()).toBe(0);
    n.seal();
    expect(n.readyCount()).toBe(1);
    expect(n.take()?.key).toBe("a");
  });

  test("put does not auto-seal after idle", () => {
    const { clock, n } = sb({ idleMs: 2 });
    n.put("a", 1);
    clock.advance(10);
    expect(n.put("b", 1)).toEqual({ epoch: 1, status: "accepted" });
    expect(n.currentEpoch()).toBe(1);
    expect(n.take()).toBeNull();
  });

  test("drive seals at most one epoch; idle from lastPut", () => {
    const { clock, n } = sb({ idleMs: 3 });
    n.put("a", 1);
    clock.advance(2);
    n.put("a", 2);
    clock.advance(2);
    expect(n.drive().sealed).toBeNull();
    clock.advance(1);
    expect(n.drive().sealed).toBe(1);
    expect(n.currentEpoch()).toBe(2);
    n.put("b", 1);
    clock.advance(10);
    expect(n.drive().sealed).toBe(2);
    expect(n.drive().sealed).toBeNull();
  });

  test("empty epoch not auto-sealed; manual empty seal drains", () => {
    const { clock, n } = sb({ idleMs: 1 });
    clock.advance(50);
    expect(n.drive().sealed).toBeNull();
    expect(n.seal().epoch).toBe(1);
    expect(n.statusOf(1)).toBe("drained");
    expect(n.currentEpoch()).toBe(2);
    expect(n.take()).toBeNull();
  });

  test("maxOpenKeys only on new keys in open epoch", () => {
    const { n } = sb({ maxOpenKeys: 2 });
    n.put("a", 1);
    n.put("b", 1);
    expect(() => n.put("c", 1)).toThrow(CapacityError);
    expect(n.put("a", 2).status).toBe("updated");
    n.seal();
    expect(n.put("c", 1)).toEqual({ epoch: 2, status: "accepted" });
  });

  test("cancel only open; sealed cancel false", () => {
    const { n } = sb();
    n.put("a", 1);
    n.put("b", 1);
    expect(n.cancel("a")).toBe(true);
    expect(n.openKeys()).toEqual(["b"]);
    n.seal();
    expect(n.cancel("b")).toBe(false);
    expect(n.take()?.key).toBe("b");
  });

  test("cancel last key clears idle anchor", () => {
    const { clock, n } = sb({ idleMs: 2 });
    n.put("a", 1);
    n.cancel("a");
    clock.advance(2);
    expect(n.drive().sealed).toBeNull();
    n.put("b", 1);
    clock.advance(2);
    expect(n.drive().sealed).toBe(1);
    expect(n.take()?.key).toBe("b");
  });

  test("take drains oldest sealed first across epochs", () => {
    const { n } = sb();
    n.put("a", 1);
    n.seal();
    n.put("b", 1);
    n.seal();
    expect(n.take()).toEqual({ epoch: 1, key: "a", payload: 1 });
    expect(n.take()).toEqual({ epoch: 2, key: "b", payload: 1 });
  });

  test("unknown epoch; invalid key; clock negative", () => {
    const { clock, n } = sb();
    expect(() => n.statusOf(2)).toThrow(UnknownEpochError);
    expect(() => n.put("", 1)).toThrow(InvalidKeyError);
    expect(() => n.cancel("")).toThrow(InvalidKeyError);
    expect(() => n.peekOpen("")).toThrow(InvalidKeyError);
    expect(() => clock.advance(-1)).toThrow();
    expect(n.statusOf(1)).toBe("open");
  });

  test("same key in next epoch is independent", () => {
    const { n } = sb();
    n.put("a", 1);
    n.seal();
    n.put("a", 2);
    n.seal();
    expect(n.take()).toEqual({ epoch: 1, key: "a", payload: 1 });
    expect(n.take()).toEqual({ epoch: 2, key: "a", payload: 2 });
  });

  test("readyCount ignores open", () => {
    const { n } = sb();
    n.put("a", 1);
    n.put("b", 1);
    expect(n.readyCount()).toBe(0);
    n.seal();
    expect(n.readyCount()).toBe(2);
    n.take();
    expect(n.readyCount()).toBe(1);
  });

  test("current open after seal", () => {
    const { n } = sb();
    n.seal();
    expect(n.currentEpoch()).toBe(2);
    expect(n.statusOf(2)).toBe("open");
    expect(n.openKeys()).toEqual([]);
  });

  test("drive does not seal empty after cancel", () => {
    const { clock, n } = sb({ idleMs: 1 });
    n.put("a", 1);
    clock.advance(1);
    n.cancel("a");
    expect(n.drive().sealed).toBeNull();
  });

  test("peekOpen undefined for missing", () => {
    const { n } = sb();
    expect(n.peekOpen("no")).toBeUndefined();
    n.put("k", 1);
    expect(n.peekOpen("k")).toBe(1);
  });

  test("take null when only drained empty seals", () => {
    const { n } = sb();
    n.seal();
    n.seal();
    expect(n.take()).toBeNull();
    expect(n.statusOf(1)).toBe("drained");
    expect(n.statusOf(2)).toBe("drained");
    expect(n.currentEpoch()).toBe(3);
  });
});
