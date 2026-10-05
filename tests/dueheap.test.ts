import {
  CapacityError,
  DueHeap,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidDueError,
  InvalidIdError,
  UnknownIdError,
  VirtualClock,
} from "../src/index.js";

function setup(opts?: { maxItems?: number; initialCredit?: number }) {
  const clock = new VirtualClock();
  const h = new DueHeap({ clock, ...opts });
  return { clock, h };
}

describe("dueheap hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new DueHeap({ clock, maxItems: 0 })).toThrow(InvalidConfigError);
    expect(() => new DueHeap({ clock, initialCredit: -1 })).toThrow(InvalidConfigError);
  });

  test("schedule accept update and capacity", () => {
    const { h } = setup({ maxItems: 2 });
    expect(h.schedule("a", 1, 10)).toEqual({ status: "accepted" });
    expect(h.schedule("a", 2, 5, 3)).toEqual({ status: "updated" });
    expect(h.costOf("a")).toBe(3);
    expect(h.dueOf("a")).toBe(5);
    expect(h.schedule("b", 1, 1)).toEqual({ status: "accepted" });
    expect(() => h.schedule("c", 1, 1)).toThrow(CapacityError);
  });

  test("illegal id due cost amount", () => {
    const { h } = setup();
    expect(() => h.schedule("", 1, 0)).toThrow(InvalidIdError);
    expect(() => h.schedule("a", 1, -1)).toThrow(InvalidDueError);
    expect(() => h.schedule("a", 1, 0, 0)).toThrow(InvalidCostError);
    expect(() => h.grant(0)).toThrow(InvalidAmountError);
  });

  test("peek never spends credit", () => {
    const { clock, h } = setup({ initialCredit: 0 });
    h.schedule("a", "x", 0, 2);
    clock.advance(0);
    expect(h.peek()?.id).toBe("a");
    expect(h.credit()).toBe(0);
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
  });

  test("pop skips unaffordable head then takes next", () => {
    const { clock, h } = setup({ initialCredit: 2 });
    h.schedule("expensive", "e", 0, 5);
    h.schedule("cheap", "c", 0, 2);
    clock.advance(1);
    expect(h.peek()?.id).toBe("expensive");
    const got = h.pop();
    expect(got?.id).toBe("cheap");
    expect(h.credit()).toBe(0);
    expect(h.ids()).toEqual(["expensive"]);
  });

  test("grant enables previously blocked pop", () => {
    const { clock, h } = setup({ initialCredit: 0 });
    h.schedule("a", 1, 0, 3);
    clock.advance(1);
    expect(h.pop()).toBeNull();
    expect(h.grant(3)).toBe(3);
    expect(h.pop()?.id).toBe("a");
    expect(h.credit()).toBe(0);
  });

  test("freeze blocks peek pop but keeps capacity", () => {
    const { clock, h } = setup({ maxItems: 1, initialCredit: 10 });
    h.schedule("a", 1, 0);
    h.freeze("a");
    expect(h.isFrozen("a")).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(1);
    expect(() => h.schedule("b", 1, 0)).toThrow(CapacityError);
    h.unfreeze("a");
    expect(h.pop()?.id).toBe("a");
  });

  test("reschedule while frozen ok and freeze unknown throws", () => {
    const { clock, h } = setup({ initialCredit: 5 });
    h.schedule("a", 1, 100);
    h.freeze("a");
    expect(h.reschedule("a", 0)).toBe(true);
    clock.advance(1);
    expect(h.peek()).toBeNull();
    h.unfreeze("a");
    expect(h.peek()?.id).toBe("a");
    expect(() => h.freeze("nope")).toThrow(UnknownIdError);
  });

  test("due order then first-schedule tie-break", () => {
    const { clock, h } = setup({ initialCredit: 10 });
    h.schedule("b", 1, 10);
    h.schedule("a", 1, 10);
    h.schedule("c", 1, 5);
    clock.advance(10);
    expect(h.readyIds()).toEqual(["c", "b", "a"]);
    expect(h.pop()?.id).toBe("c");
    expect(h.pop()?.id).toBe("b");
    expect(h.pop()?.id).toBe("a");
  });

  test("drive snapshot and budget interleaved skip", () => {
    const { clock, h } = setup({ initialCredit: 2 });
    h.schedule("a", 1, 0, 3);
    h.schedule("b", 1, 0, 2);
    h.schedule("c", 1, 0, 2);
    clock.advance(1);
    // peek order a,b,c — a unaffordable, take b, credit 0, stop
    const { drained } = h.drive();
    expect(drained.map((d) => d.id)).toEqual(["b"]);
    expect(h.credit()).toBe(0);
    expect(h.ids().sort()).toEqual(["a", "c"]);
  });

  test("drive does not take not-yet-due under snapshot", () => {
    const { clock, h } = setup({ initialCredit: 10 });
    h.schedule("soon", 1, 5);
    h.schedule("later", 1, 100);
    clock.advance(5);
    const { drained } = h.drive();
    expect(drained.map((d) => d.id)).toEqual(["soon"]);
    expect(h.ids()).toEqual(["later"]);
  });

  test("cancel frees capacity and clears freeze", () => {
    const { h } = setup({ maxItems: 1, initialCredit: 1 });
    h.schedule("a", 1, 0);
    h.freeze("a");
    expect(h.cancel("a")).toBe(true);
    expect(h.size()).toBe(0);
    expect(h.schedule("b", 1, 0)).toEqual({ status: "accepted" });
    expect(() => h.isFrozen("a")).toThrow(UnknownIdError);
  });

  test("update preserves first-schedule order for ties", () => {
    const { clock, h } = setup({ initialCredit: 5 });
    h.schedule("first", 1, 10);
    h.schedule("second", 1, 10);
    h.schedule("first", 9, 10); // update payload, same due
    clock.advance(10);
    expect(h.readyIds()).toEqual(["first", "second"]);
  });

  test("frozen due item still in ids and readyIds omits it", () => {
    const { clock, h } = setup({ initialCredit: 5 });
    h.schedule("a", 1, 0);
    h.schedule("b", 1, 0);
    h.freeze("a");
    clock.advance(1);
    expect(h.ids()).toEqual(["a", "b"]);
    expect(h.readyIds()).toEqual(["b"]);
  });

  test("multi-step: freeze budget reschedule unfreeze drive", () => {
    const { clock, h } = setup({ maxItems: 4, initialCredit: 1 });
    h.schedule("x", "x", 50, 2);
    h.schedule("y", "y", 10, 1);
    h.schedule("z", "z", 10, 5);
    h.freeze("y");
    clock.advance(10);
    // y frozen, z unaffordable, x not due
    expect(h.pop()).toBeNull();
    expect(h.reschedule("x", 10)).toBe(true);
    expect(h.pop()).toBeNull(); // x cost 2 > credit 1
    h.grant(1);
    expect(h.pop()?.id).toBe("x");
    h.unfreeze("y");
    h.grant(10);
    clock.advance(0);
    const { drained } = h.drive();
    // y due cost1, z due cost5 — both affordable after grant path
    expect(drained.map((d) => d.id)).toEqual(["y", "z"]);
    expect(h.size()).toBe(0);
  });

  test("multi-step: capacity held by frozen blocks accept then cancel path", () => {
    const { clock, h } = setup({ maxItems: 2, initialCredit: 3 });
    h.schedule("a", 1, 0, 1);
    h.schedule("b", 1, 0, 1);
    h.freeze("a");
    h.freeze("b");
    expect(() => h.schedule("c", 1, 0)).toThrow(CapacityError);
    clock.advance(1);
    expect(h.drive().drained).toEqual([]);
    expect(h.cancel("a")).toBe(true);
    expect(h.schedule("c", 1, 0, 2)).toEqual({ status: "accepted" });
    h.unfreeze("b");
    // credit 3: b cost1 then c cost2
    expect(h.drive().drained.map((d) => d.id)).toEqual(["b", "c"]);
  });

  test("multi-step: peek shows expensive head while pop drains tail then grant", () => {
    const { clock, h } = setup({ initialCredit: 1 });
    h.schedule("h", 1, 0, 10);
    h.schedule("m", 1, 1, 1);
    h.schedule("t", 1, 1, 1);
    clock.advance(1);
    expect(h.peek()?.id).toBe("h");
    expect(h.pop()?.id).toBe("m");
    expect(h.credit()).toBe(0);
    expect(h.peek()?.id).toBe("h");
    h.grant(10);
    expect(h.pop()?.id).toBe("h");
    expect(h.credit()).toBe(0);
    h.grant(1);
    expect(h.pop()?.id).toBe("t");
  });

  test("multi-step: cancel mid readiness and re-schedule same id", () => {
    const { clock, h } = setup({ initialCredit: 3 });
    h.schedule("a", 1, 0);
    h.schedule("b", 1, 0);
    clock.advance(1);
    expect(h.cancel("a")).toBe(true);
    expect(h.schedule("a", 2, 0, 2)).toEqual({ status: "accepted" });
    // order: b (old), a (new) — both due; credit 3 takes b then a
    expect(h.drive().drained.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("multi-step: freeze after due still skipped until unfreeze across advances", () => {
    const { clock, h } = setup({ initialCredit: 5 });
    h.schedule("a", 1, 5, 1);
    h.schedule("b", 1, 5, 1);
    clock.advance(5);
    h.freeze("a");
    expect(h.readyIds()).toEqual(["b"]);
    clock.advance(100);
    expect(h.pop()?.id).toBe("b");
    expect(h.pop()).toBeNull();
    h.unfreeze("a");
    expect(h.pop()?.id).toBe("a");
  });
});
