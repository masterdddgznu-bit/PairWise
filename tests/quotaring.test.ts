import { VirtualClock } from "../src/clock.js";
import { InvalidConfigError, InvalidTicketError } from "../src/errors.js";
import { QuotaRing } from "../src/quotaring.js";
import type { NodeSpec } from "../src/types.js";

function single(hard = 10, soft = 6) {
  const clock = new VirtualClock();
  const q = new QuotaRing({
    clock,
    nodes: [{ id: "n", soft, hard }],
  });
  return { clock, q };
}

function tree() {
  const clock = new VirtualClock();
  const nodes: NodeSpec[] = [
    { id: "root", soft: 8, hard: 12 },
    { id: "a", parentId: "root", soft: 5, hard: 8 },
    { id: "b", parentId: "root", soft: 5, hard: 8 },
    { id: "a1", parentId: "a", soft: 3, hard: 6 },
  ];
  const q = new QuotaRing({ clock, nodes });
  return { clock, q };
}

describe("quotaring config", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new QuotaRing({ clock, nodes: [{ id: "x", soft: 5, hard: 3 }] }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new QuotaRing({
          clock,
          nodes: [
            { id: "x", soft: 1, hard: 2 },
            { id: "y", parentId: "missing", soft: 1, hard: 2 },
          ],
        }),
    ).toThrow(InvalidConfigError);
  });
});

describe("quotaring happy paths", () => {
  test("reserve commit release on single node", () => {
    const { q } = single();
    expect(q.reserve("n", 4, 100, "t1")).toEqual({ ok: true });
    expect(q.usage("n")).toMatchObject({
      committed: 0,
      reserved: 4,
      overSoft: false,
    });
    q.commit("t1", 4);
    expect(q.usage("n")).toMatchObject({ committed: 4, reserved: 0 });
    expect(q.release("t1")).toBe(false);
  });

  test("release frees capacity", () => {
    const { q } = single(5, 5);
    expect(q.reserve("n", 5, 50, "t")).toEqual({ ok: true });
    expect(q.canAdmit("n", 1)).toBe(false);
    expect(q.release("t")).toBe(true);
    expect(q.canAdmit("n", 5)).toBe(true);
  });

  test("hard deny on leaf alone", () => {
    const { q } = single(5, 3);
    expect(q.reserve("n", 5, 10, "a")).toEqual({ ok: true });
    expect(q.reserve("n", 1, 10, "b")).toEqual({
      ok: false,
      reason: "hard",
    });
  });
});

describe("quotaring boundaries", () => {
  test("ancestor hard blocks child even when child has room", () => {
    const { q } = tree();
    // root hard=12; fill with sibling b first
    expect(q.reserve("b", 8, 100, "tb")).toEqual({ ok: true });
    // a1 hard=6 but root only has 4 left
    expect(q.reserve("a1", 5, 100, "ta")).toEqual({
      ok: false,
      reason: "hard",
    });
    expect(q.reserve("a1", 4, 100, "ta")).toEqual({ ok: true });
    expect(q.usage("root").reserved).toBe(12);
    expect(q.usage("a").reserved).toBe(4);
  });

  test("renew same ticketId replaces without leaking", () => {
    const { clock, q } = single(10, 8);
    expect(q.reserve("n", 6, 50, "x")).toEqual({ ok: true });
    clock.advance(10);
    expect(q.reserve("n", 3, 50, "x")).toEqual({ ok: true });
    expect(q.usage("n").reserved).toBe(3);
    expect(q.canAdmit("n", 7)).toBe(true);
    expect(q.canAdmit("n", 8)).toBe(false);
  });

  test("ttl boundary now==expireAt is reclaimed", () => {
    const { clock, q } = single(10, 8);
    expect(q.reserve("n", 7, 20, "z")).toEqual({ ok: true });
    clock.advance(19);
    expect(q.drive()).toEqual([]);
    expect(q.usage("n").reserved).toBe(7);
    clock.advance(1);
    expect(q.drive()).toEqual(["z"]);
    expect(q.usage("n").reserved).toBe(0);
    expect(q.canAdmit("n", 10)).toBe(true);
  });

  test("partial commit frees unused reserved on path", () => {
    const { q } = tree();
    expect(q.reserve("a1", 6, 100, "p")).toEqual({ ok: true });
    q.commit("p", 2);
    expect(q.usage("a1")).toMatchObject({ committed: 2, reserved: 4 });
    expect(q.usage("a")).toMatchObject({ committed: 2, reserved: 4 });
    expect(q.usage("root")).toMatchObject({ committed: 2, reserved: 4 });
    // a1 hard=6 with load 6 → no room; after release reserved, room for more
    expect(q.canAdmit("a1", 1)).toBe(false);
    expect(q.release("p")).toBe(true);
    expect(q.canAdmit("a1", 4)).toBe(true);
    expect(q.usage("a1")).toMatchObject({ committed: 2, reserved: 0 });
    expect(q.usage("root").reserved).toBe(0);
  });

  test("overSoft counts reserved; multi expire sorted", () => {
    const { clock, q } = single(10, 4);
    expect(q.reserve("n", 3, 10, "m")).toEqual({ ok: true });
    expect(q.reserve("n", 2, 30, "k")).toEqual({ ok: true });
    expect(q.usage("n").overSoft).toBe(true);
    clock.advance(10);
    expect(q.drive()).toEqual(["m"]);
    expect(q.usage("n")).toMatchObject({ reserved: 2, overSoft: false });
    clock.advance(20);
    expect(q.drive()).toEqual(["k"]);
  });

  test("commit after renew and hierarchy interaction", () => {
    const { clock, q } = tree();
    expect(q.reserve("a1", 4, 40, "r")).toEqual({ ok: true });
    clock.advance(5);
    expect(q.reserve("a1", 5, 40, "r")).toEqual({ ok: true });
    expect(q.usage("root").reserved).toBe(5);
    q.commit("r", 5);
    expect(q.usage("root")).toMatchObject({ committed: 5, reserved: 0 });
    expect(q.reserve("b", 8, 10, "bb")).toEqual({
      ok: false,
      reason: "hard",
    });
    expect(q.reserve("b", 7, 10, "bb")).toEqual({ ok: true });
  });
});
