import {
  VirtualClock,
  TwinBuf,
  InvalidConfigError,
  InvalidKeyError,
  CapacityError,
  SwapBlockedError,
} from "../src/index.js";

function tb(
  o: Partial<{ idleMs: number; maxStaging: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new TwinBuf({
    clock,
    idleMs: o.idleMs ?? 5,
    maxStaging: o.maxStaging ?? 4,
  });
  return { clock, n };
}

describe("twinbuf hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new TwinBuf({ clock, idleMs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new TwinBuf({ clock, idleMs: 1, maxStaging: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("write staging; take only after swap", () => {
    const { n } = tb();
    expect(n.write("a", 1)).toEqual({ status: "accepted" });
    expect(n.take()).toBeNull();
    expect(n.swap()).toBe(true);
    expect(n.take()).toEqual({ key: "a", payload: 1 });
    expect(n.stagingCount()).toBe(0);
  });

  test("LWW keeps first-insert order", () => {
    const { n } = tb();
    n.write("b", 1);
    n.write("a", 1);
    n.write("b", 9);
    expect(n.stagingKeys()).toEqual(["b", "a"]);
    expect(n.peekStaging("b")).toBe(9);
    n.swap();
    expect(n.take()?.key).toBe("b");
    expect(n.take()?.payload).toBe(1);
  });

  test("write does not auto-swap after idle", () => {
    const { clock, n } = tb({ idleMs: 2 });
    n.write("a", 1);
    clock.advance(10);
    n.write("b", 1);
    expect(n.activeCount()).toBe(0);
    expect(n.take()).toBeNull();
  });

  test("drive swaps when idle and active empty", () => {
    const { clock, n } = tb({ idleMs: 3 });
    n.write("a", 1);
    clock.advance(2);
    expect(n.drive().swapped).toBe(false);
    clock.advance(1);
    expect(n.drive().swapped).toBe(true);
    expect(n.activeKeys()).toEqual(["a"]);
    expect(n.stagingKeys()).toEqual([]);
  });

  test("drive blocked while active nonempty; swap throws", () => {
    const { clock, n } = tb({ idleMs: 1 });
    n.write("a", 1);
    n.swap();
    n.write("b", 1);
    clock.advance(1);
    expect(n.drive().swapped).toBe(false);
    expect(() => n.swap()).toThrow(SwapBlockedError);
    n.take();
    expect(n.drive().swapped).toBe(true);
    expect(n.take()?.key).toBe("b");
  });

  test("swap empty staging false", () => {
    const { n } = tb();
    expect(n.swap()).toBe(false);
  });

  test("LWW resets idle anchor", () => {
    const { clock, n } = tb({ idleMs: 5 });
    n.write("a", 1);
    clock.advance(4);
    n.write("a", 2);
    clock.advance(4);
    expect(n.drive().swapped).toBe(false);
    clock.advance(1);
    expect(n.drive().swapped).toBe(true);
    expect(n.take()?.payload).toBe(2);
  });

  test("maxStaging capacity", () => {
    const { n } = tb({ maxStaging: 2 });
    n.write("a", 1);
    n.write("b", 1);
    expect(() => n.write("c", 1)).toThrow(CapacityError);
    expect(n.write("a", 9).status).toBe("updated");
  });

  test("cancel staging only; frees capacity and clears idle", () => {
    const { clock, n } = tb({ idleMs: 1, maxStaging: 1 });
    n.write("a", 1);
    expect(n.cancel("a")).toBe(true);
    clock.advance(1);
    expect(n.drive().swapped).toBe(false);
    expect(n.write("b", 1)).toEqual({ status: "accepted" });
    n.swap();
    expect(n.cancel("b")).toBe(false);
    expect(n.take()?.key).toBe("b");
  });

  test("invalid key; clock negative", () => {
    const { clock, n } = tb();
    expect(() => n.write("", 1)).toThrow(InvalidKeyError);
    expect(() => n.cancel("")).toThrow(InvalidKeyError);
    expect(() => n.peekStaging("")).toThrow(InvalidKeyError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("take fifo active; staging independent", () => {
    const { n } = tb();
    n.write("a", 1);
    n.write("b", 1);
    n.swap();
    n.write("c", 1);
    expect(n.take()?.key).toBe("a");
    expect(n.stagingKeys()).toEqual(["c"]);
    expect(n.take()?.key).toBe("b");
    expect(n.take()).toBeNull();
  });

  test("peekActive and peekStaging", () => {
    const { n } = tb();
    n.write("a", 1);
    expect(n.peekActive("a")).toBeUndefined();
    n.swap();
    expect(n.peekStaging("a")).toBeUndefined();
    expect(n.peekActive("a")).toBe(1);
  });

  test("cancel last of many clears idle only when empty", () => {
    const { clock, n } = tb({ idleMs: 2 });
    n.write("a", 1);
    n.write("b", 1);
    n.cancel("a");
    clock.advance(2);
    expect(n.drive().swapped).toBe(true);
    expect(n.activeKeys()).toEqual(["b"]);
  });

  test("counts", () => {
    const { n } = tb();
    n.write("a", 1);
    n.write("b", 1);
    expect(n.stagingCount()).toBe(2);
    n.swap();
    expect(n.activeCount()).toBe(2);
    expect(n.stagingCount()).toBe(0);
  });

  test("drive empty staging false", () => {
    const { clock, n } = tb({ idleMs: 1 });
    clock.advance(10);
    expect(n.drive().swapped).toBe(false);
  });

  test("after swap can write same keys again in staging", () => {
    const { n } = tb();
    n.write("a", 1);
    n.swap();
    expect(n.write("a", 2)).toEqual({ status: "accepted" });
    expect(n.stagingKeys()).toEqual(["a"]);
    n.take();
    n.swap();
    expect(n.take()?.payload).toBe(2);
  });
});
