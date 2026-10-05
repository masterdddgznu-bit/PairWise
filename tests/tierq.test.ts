import {
  CapacityError,
  CooldownError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
  TierQ,
  VirtualClock,
} from "../src/index.js";

function q(opts?: {
  promoteMs?: number;
  cooldownMs?: number;
  tierCount?: number;
  maxItems?: number;
  promoteMinSize?: number;
}) {
  const clock = new VirtualClock();
  const tq = new TierQ({
    clock,
    promoteMs: opts?.promoteMs ?? 10,
    cooldownMs: opts?.cooldownMs ?? 5,
    tierCount: opts?.tierCount,
    maxItems: opts?.maxItems,
    promoteMinSize: opts?.promoteMinSize,
  });
  return { clock, tq };
}

describe("tierq hell 0-1", () => {
  test("rejects invalid config and ids", () => {
    const clock = new VirtualClock();
    expect(() => new TierQ({ clock, promoteMs: 0, cooldownMs: 1 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new TierQ({ clock, promoteMs: 1, cooldownMs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new TierQ({ clock, promoteMs: 1, cooldownMs: 1, tierCount: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new TierQ({ clock, promoteMs: 1, cooldownMs: 1, promoteMinSize: 0 }),
    ).toThrow(InvalidConfigError);
    const { tq } = q();
    expect(() => tq.push("", 1)).toThrow(InvalidIdError);
    expect(() => tq.push("a", 1, "")).toThrow(InvalidIdError);
    expect(() => tq.idsInTier(-1)).toThrow(InvalidConfigError);
  });

  test("push starts at tier 0; duplicate and capacity", () => {
    const { tq } = q({ maxItems: 2 });
    expect(tq.push("a", 1).status).toBe("accepted");
    expect(tq.tierOf("a")).toBe(0);
    expect(tq.tenantOf("a")).toBe("a");
    expect(() => tq.push("a", 2)).toThrow(DuplicateIdError);
    tq.push("b", 2, "t1");
    expect(tq.tenantOf("b")).toBe("t1");
    expect(() => tq.push("c", 3)).toThrow(CapacityError);
  });

  test("drive promotes one tier only; stamp resets", () => {
    const { clock, tq } = q({ promoteMs: 10, tierCount: 4, maxItems: 8 });
    tq.push("a", 1);
    clock.advance(100);
    expect(tq.drive().promoted).toEqual(["a"]);
    expect(tq.tierOf("a")).toBe(1);
    expect(tq.drive().promoted).toEqual([]);
    clock.advance(10);
    expect(tq.drive().promoted).toEqual(["a"]);
    expect(tq.tierOf("a")).toBe(2);
  });

  test("promoteMinSize blocks lonely tier until peers arrive", () => {
    const { clock, tq } = q({
      promoteMs: 5,
      promoteMinSize: 2,
      maxItems: 8,
    });
    tq.push("solo", 1);
    clock.advance(5);
    expect(tq.drive()).toEqual({ promoted: [], cooledSkipped: [] });
    tq.push("p1", 2);
    tq.push("p2", 3);
    // snapshot tier0=3 >= 2; only solo age-ready
    expect(tq.drive().promoted).toEqual(["solo"]);
    expect(tq.tierOf("solo")).toBe(1);
    clock.advance(5);
    // p1,p2 still together in tier0
    expect(tq.drive().promoted).toEqual(["p1", "p2"]);
    expect(tq.tierOf("p1")).toBe(1);
    expect(tq.tierOf("p2")).toBe(1);
  });

  test("pop registers id and tenant cooldown; blocks re-push", () => {
    const { clock, tq } = q({ promoteMs: 10, cooldownMs: 7, maxItems: 8 });
    tq.push("a", 1, "ten");
    expect(tq.pop()).toEqual({ id: "a", payload: 1, tier: 0, tenant: "ten" });
    expect(tq.cooldownUntil("a")).toBe(7);
    expect(tq.cooldownUntil("ten")).toBe(7);
    expect(() => tq.push("a", 9)).toThrow(CooldownError);
    clock.advance(7);
    expect(tq.cooldownUntil("a")).toBeNull();
    expect(tq.push("a", 9).status).toBe("accepted");
  });

  test("tenant cooldown blocks promote of sibling id", () => {
    const { clock, tq } = q({
      promoteMs: 5,
      cooldownMs: 20,
      maxItems: 8,
    });
    tq.push("x", 1, "team");
    tq.push("y", 2, "team");
    expect(tq.pop()?.id).toBe("x"); // both tier0; first-push x
    clock.advance(5);
    const d = tq.drive();
    expect(d.promoted).toEqual([]);
    expect(d.cooledSkipped).toEqual(["y"]);
    expect(tq.tierOf("y")).toBe(0);
    clock.advance(15);
    expect(tq.drive().promoted).toEqual(["y"]);
  });

  test("peek/pop prefer higher tier then first-push order", () => {
    const { clock, tq } = q({ promoteMs: 10, cooldownMs: 1, maxItems: 8 });
    tq.push("a", 1);
    tq.push("b", 2);
    clock.advance(10);
    tq.drive();
    expect(tq.peek()?.id).toBe("a");
    tq.push("c", 3);
    clock.advance(10);
    tq.drive();
    expect(tq.tierOf("a")).toBe(2);
    expect(tq.tierOf("c")).toBe(1);
    expect(tq.pop()?.id).toBe("a");
    expect(tq.pop()?.id).toBe("b");
    expect(tq.pop()?.id).toBe("c");
  });

  test("push/pop do not promote", () => {
    const { clock, tq } = q({ promoteMs: 10, cooldownMs: 1, maxItems: 8 });
    tq.push("a", 1);
    clock.advance(10);
    expect(tq.peek()?.tier).toBe(0);
    expect(tq.pop()?.tier).toBe(0);
  });

  test("promoted list follows first-push order", () => {
    const { clock, tq } = q({ promoteMs: 5, cooldownMs: 1, maxItems: 8 });
    tq.push("z", 1);
    tq.push("a", 2);
    clock.advance(5);
    expect(tq.drive().promoted).toEqual(["z", "a"]);
  });

  test("staggered pushes promote on different drives", () => {
    const { clock, tq } = q({ promoteMs: 10, cooldownMs: 1, maxItems: 8 });
    tq.push("early", 1);
    clock.advance(5);
    tq.push("late", 2);
    clock.advance(5);
    expect(tq.drive().promoted).toEqual(["early"]);
    clock.advance(5);
    expect(tq.drive().promoted).toEqual(["late"]);
  });

  test("cancel frees capacity without cooldown", () => {
    const { tq } = q({ maxItems: 2, cooldownMs: 50 });
    tq.push("a", 1);
    tq.push("b", 2);
    expect(tq.cancel("a")).toBe(true);
    expect(tq.cooldownUntil("a")).toBeNull();
    expect(tq.push("c", 3).status).toBe("accepted");
  });

  test("interleaved promote, pop cooldown, and minSize", () => {
    const { clock, tq } = q({
      promoteMs: 4,
      cooldownMs: 6,
      tierCount: 3,
      maxItems: 6,
      promoteMinSize: 2,
    });
    tq.push("a", 1, "g");
    tq.push("b", 2, "g");
    clock.advance(4);
    expect(tq.drive().promoted).toEqual(["a", "b"]);
    expect(tq.pop()?.id).toBe("a");
    clock.advance(4);
    // b same tenant cooled; alone in tier1 also minSize=2 blocks anyway
    const d = tq.drive();
    expect(d.promoted).toEqual([]);
    expect(d.cooledSkipped).toEqual(["b"]);
    tq.push("c", 3, "other");
    clock.advance(6);
    // b cooldown ended; tier1 size snapshot=1 < 2 still blocks b
    expect(tq.tierOf("b")).toBe(1);
    expect(tq.drive().promoted).toEqual([]);
    // promote c from 0 needs peer in tier0
    tq.push("d", 4);
    clock.advance(4);
    expect(tq.drive().promoted).toEqual(["c", "d"]);
  });

  test("default tierCount 3 and maxItems 16", () => {
    const { clock, tq } = q({ promoteMs: 1, cooldownMs: 1 });
    for (let i = 0; i < 16; i++) tq.push(`k${i}`, i);
    expect(() => tq.push("x", 1)).toThrow(CapacityError);
    clock.advance(1);
    tq.drive();
    clock.advance(1);
    tq.drive();
    expect(tq.tierOf("k0")).toBe(2);
  });

  test("exact boundary now === stamp + promoteMs eligible", () => {
    const { clock, tq } = q({ promoteMs: 7, cooldownMs: 1, maxItems: 4 });
    tq.push("a", 1);
    clock.advance(6);
    expect(tq.drive().promoted).toEqual([]);
    clock.advance(1);
    expect(tq.drive().promoted).toEqual(["a"]);
  });

  test("cooldown now === until is finished", () => {
    const { clock, tq } = q({ promoteMs: 10, cooldownMs: 5, maxItems: 4 });
    tq.push("a", 1);
    tq.pop();
    clock.advance(5);
    expect(tq.cooldownUntil("a")).toBeNull();
    expect(tq.push("a", 2).status).toBe("accepted");
  });

  test("idsInTier respects first-push order after promote", () => {
    const { clock, tq } = q({ promoteMs: 5, cooldownMs: 1, maxItems: 8 });
    tq.push("x", 1);
    tq.push("y", 2);
    tq.push("z", 3);
    clock.advance(5);
    tq.drive();
    expect(tq.idsInTier(1)).toEqual(["x", "y", "z"]);
  });
});
