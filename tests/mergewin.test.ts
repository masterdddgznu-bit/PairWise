import {
  BarrierError,
  CapacityError,
  InvalidConfigError,
  InvalidKeyError,
  InvalidVersionError,
  MergeWin,
  VirtualClock,
} from "../src/index.js";

describe("mergewin hell 0-1", () => {
  test("rejects invalid config, keys, versions", () => {
    const clock = new VirtualClock();
    expect(() => new MergeWin({ clock, idleMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new MergeWin({ clock, idleMs: 1, maxKeys: 0 })).toThrow(
      InvalidConfigError,
    );
    const m = new MergeWin({ clock, idleMs: 5, maxKeys: 4 });
    expect(() => m.put("", 1)).toThrow(InvalidKeyError);
    expect(() => m.put("a", 1, -1)).toThrow(InvalidVersionError);
    expect(() => m.put("a", 1, 1.5)).toThrow(InvalidVersionError);
    expect(() => m.peek("")).toThrow(InvalidKeyError);
  });

  test("put accepted/updated/merged/ignored by version rules", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 10, maxKeys: 8 });
    expect(m.put("a", 1, 1).status).toBe("accepted");
    expect(m.put("a", 2, 2).status).toBe("updated");
    expect(m.versionOf("a")).toBe(2);
    expect(m.put("a", 3, 2).status).toBe("merged");
    expect(m.peek("a")).toBe(3);
    expect(m.put("a", 9, 1).status).toBe("ignored");
    expect(m.peek("a")).toBe(3);
    expect(m.versionOf("a")).toBe(2);
  });

  test("update/merge keep first-put order", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 10, maxKeys: 8 });
    m.put("a", 1, 1);
    m.put("b", 2, 1);
    m.put("a", 9, 2);
    expect(m.keys()).toEqual(["a", "b"]);
  });

  test("capacity and cancel", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 10, maxKeys: 2 });
    m.put("a", 1);
    m.put("b", 2);
    expect(() => m.put("c", 3)).toThrow(CapacityError);
    expect(m.cancel("a")).toBe(true);
    expect(m.put("c", 3).status).toBe("accepted");
    expect(m.keys()).toEqual(["b", "c"]);
  });

  test("ignored stale put does not refresh touchedAt", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 5, maxKeys: 4 });
    m.put("a", 1, 2);
    clock.advance(3);
    expect(m.put("a", 9, 1).status).toBe("ignored");
    expect(m.touchedAt("a")).toBe(0);
  });

  test("openBarrier stamps writes; flush waits for close", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 1, maxKeys: 8 });
    m.put("free", 1, 1);
    const g = m.openBarrier();
    expect(g).toBe(1);
    expect(m.isBarrierOpen()).toBe(true);
    m.put("held", 2, 1);
    expect(m.barrierGenOf("held")).toBe(1);
    expect(m.barrierGenOf("free")).toBe(0);
    expect(m.flush().items.map((x) => x.key)).toEqual(["free"]);
    expect(m.keys()).toEqual(["held"]);
    expect(m.closeBarrier(g)).toBe(true);
    expect(m.flush().items).toEqual([{ key: "held", payload: 2, version: 1 }]);
  });

  test("double openBarrier throws; wrong close is false", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 1, maxKeys: 4 });
    const g = m.openBarrier();
    expect(() => m.openBarrier()).toThrow(BarrierError);
    expect(m.closeBarrier(g + 1)).toBe(false);
    expect(m.closeBarrier(g)).toBe(true);
    expect(m.currentBarrier()).toBe(0);
  });

  test("drive requires both idle and barrier release", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 10, maxKeys: 8 });
    const g = m.openBarrier();
    m.put("a", 1, 1);
    clock.advance(10);
    expect(m.drive().items).toEqual([]);
    expect(m.closeBarrier(g)).toBe(true);
    expect(m.drive().items).toEqual([{ key: "a", payload: 1, version: 1 }]);
  });

  test("merged put under barrier refreshes touch and delays drive", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 10, maxKeys: 8 });
    const g = m.openBarrier();
    m.put("a", 1, 1);
    clock.advance(9);
    expect(m.put("a", 2, 1).status).toBe("merged");
    expect(m.closeBarrier(g)).toBe(true);
    clock.advance(9);
    expect(m.drive().items).toEqual([]);
    clock.advance(1);
    expect(m.drive().items).toEqual([{ key: "a", payload: 2, version: 1 }]);
  });

  test("exact idle boundary eligible after release", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 7, maxKeys: 4 });
    m.put("a", 1, 0);
    clock.advance(6);
    expect(m.drive().items).toEqual([]);
    clock.advance(1);
    expect(m.drive().items).toEqual([{ key: "a", payload: 1, version: 0 }]);
  });

  test("interleaved: partial drive, barrier hold, capacity, flush", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 4, maxKeys: 3 });
    m.put("a", 1, 1);
    clock.advance(2);
    m.put("b", 2, 1);
    const g = m.openBarrier();
    clock.advance(2);
    m.put("c", 3, 1);
    expect(() => m.put("d", 4, 1)).toThrow(CapacityError);
    expect(m.drive().items).toEqual([{ key: "a", payload: 1, version: 1 }]);
    expect(m.put("d", 4, 1).status).toBe("accepted");
    expect(m.barrierGenOf("d")).toBe(1);
    clock.advance(2);
    expect(m.drive().items).toEqual([{ key: "b", payload: 2, version: 1 }]);
    expect(m.closeBarrier(g)).toBe(true);
    expect(m.flush().items.map((x) => x.key)).toEqual(["c", "d"]);
  });

  test("interleaved: version race across barrier generations", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 5, maxKeys: 8 });
    m.put("k", "v0", 1);
    const g1 = m.openBarrier();
    expect(m.put("k", "v1", 2).status).toBe("updated");
    expect(m.barrierGenOf("k")).toBe(1);
    expect(m.closeBarrier(g1)).toBe(true);
    const g2 = m.openBarrier();
    expect(m.put("k", "stale", 1).status).toBe("ignored");
    expect(m.put("k", "v2", 2).status).toBe("merged");
    clock.advance(5);
    expect(m.drive().items).toEqual([]);
    expect(m.closeBarrier(g2)).toBe(true);
    expect(m.drive().items).toEqual([{ key: "k", payload: "v2", version: 2 }]);
  });

  test("interleaved: cancel held key; drive sibling after release", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 3, maxKeys: 4 });
    const g = m.openBarrier();
    m.put("a", 1, 1);
    m.put("b", 2, 1);
    clock.advance(3);
    expect(m.cancel("a")).toBe(true);
    expect(m.drive().items).toEqual([]);
    expect(m.closeBarrier(g)).toBe(true);
    expect(m.drive().items).toEqual([{ key: "b", payload: 2, version: 1 }]);
  });

  test("interleaved: flush strips released only; reopen new gen", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 100, maxKeys: 8 });
    m.put("x", 1, 1);
    const g1 = m.openBarrier();
    m.put("y", 2, 1);
    expect(m.closeBarrier(g1)).toBe(true);
    const g2 = m.openBarrier();
    m.put("z", 3, 1);
    expect(m.flush().items.map((i) => i.key)).toEqual(["x", "y"]);
    expect(m.keys()).toEqual(["z"]);
    expect(m.closeBarrier(g2)).toBe(true);
    expect(m.flush().items).toEqual([{ key: "z", payload: 3, version: 1 }]);
  });

  test("interleaved: default version 0 and default maxKeys 16", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 1 });
    for (let i = 0; i < 16; i++) {
      expect(m.put(`k${i}`, i).status).toBe("accepted");
      expect(m.versionOf(`k${i}`)).toBe(0);
    }
    expect(() => m.put("x", 1)).toThrow(CapacityError);
    clock.advance(1);
    expect(m.drive().items).toHaveLength(16);
  });

  test("put/cancel/peek do not drive even when idle and released", () => {
    const clock = new VirtualClock();
    const m = new MergeWin({ clock, idleMs: 5, maxKeys: 8 });
    m.put("a", 1, 1);
    clock.advance(5);
    expect(m.peek("a")).toBe(1);
    m.put("b", 2, 1);
    expect(m.cancel("missing")).toBe(false);
    expect(m.size()).toBe(2);
  });
});
