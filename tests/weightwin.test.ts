import {
  CapacityError,
  DuplicateIdError,
  InvalidBoostError,
  InvalidConfigError,
  InvalidIdError,
  InvalidPriorityError,
  InvalidWeightError,
  UnknownIdError,
  VirtualClock,
  WeightWin,
} from "../src/index.js";

describe("weightwin hell 0-1", () => {
  test("rejects invalid config / id / weight / priority", () => {
    const clock = new VirtualClock();
    expect(() => new WeightWin({ clock, windowMs: 0, maxSum: 5 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new WeightWin({ clock, windowMs: 1, maxSum: 0 })).toThrow(
      InvalidConfigError,
    );
    const w = new WeightWin({ clock, windowMs: 10, maxSum: 5 });
    expect(() => w.add("", 1, 0)).toThrow(InvalidIdError);
    expect(() => w.add("a", 0, 0)).toThrow(InvalidWeightError);
    expect(() => w.add("a", 1, -1)).toThrow(InvalidPriorityError);
  });

  test("capacity by effective weight; exact maxSum ok", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 100, maxSum: 5 });
    expect(w.add("a", 2, 1).shed).toEqual([]);
    expect(w.add("b", 3, 1).shed).toEqual([]);
    expect(w.sum()).toBe(5);
    // c is lowest priority → shed self to stay under cap
    expect(w.add("c", 1, 0).shed).toEqual(["c"]);
    expect(w.sum()).toBe(5);
    expect(() => w.add("heavy", 6, 9)).toThrow(CapacityError);
  });

  test("shed lowest priority on admit; tie-break first-add", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 100, maxSum: 5 });
    w.add("a", 2, 0);
    w.add("b", 2, 1);
    const r = w.add("c", 3, 2);
    // need shed 2 weight: a priority 0 first
    expect(r.shed).toEqual(["a"]);
    expect(w.inWindowIds()).toEqual(["b", "c"]);
    expect(w.sum()).toBe(5);
  });

  test("duplicate rejected; cancel frees budget", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 100, maxSum: 5 });
    w.add("a", 3, 1);
    expect(() => w.add("a", 1, 1)).toThrow(DuplicateIdError);
    expect(w.cancel("a")).toBe(true);
    expect(w.add("a", 5, 0).status).toBe("accepted");
  });

  test("exact boundary now - ts === windowMs is out of sum", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 5, maxSum: 10 });
    w.add("a", 4, 0);
    clock.advance(4);
    expect(w.sum()).toBe(4);
    clock.advance(1);
    expect(w.sum()).toBe(0);
    expect(w.size()).toBe(1);
    expect(w.inWindowIds()).toEqual([]);
  });

  test("queries do not purge; drive purges in first-add order", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 3, maxSum: 20 });
    w.add("z", 1, 0);
    clock.advance(1);
    w.add("a", 2, 0);
    clock.advance(1);
    w.add("m", 3, 0);
    clock.advance(2);
    expect(w.sum()).toBe(3);
    expect(w.size()).toBe(3);
    expect(w.drive().purged).toEqual(["z", "a"]);
    expect(w.ids()).toEqual(["m"]);
  });

  test("boost raises effective weight and can force shed", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 50, maxSum: 5 });
    w.add("a", 2, 0);
    w.add("b", 2, 1);
    const b = w.boost("b", 2, 10);
    expect(b.boostId).toBe(1);
    // effective 2+4=6 > 5 → shed a
    expect(w.ids()).toEqual(["b"]);
    expect(w.effectiveWeightOf("b")).toBe(4);
    expect(w.activeBoostIds("b")).toEqual([1]);
  });

  test("boost expiry via drive frees weight; queries do not expire", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 100, maxSum: 10 });
    w.add("a", 3, 0);
    w.boost("a", 2, 5);
    clock.advance(5);
    expect(w.effectiveWeightOf("a")).toBe(5);
    expect(w.activeBoostIds("a")).toEqual([1]);
    const d = w.drive();
    expect(d.expiredBoosts).toEqual([1]);
    expect(w.effectiveWeightOf("a")).toBe(3);
  });

  test("invalid boost args and unknown id", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 10, maxSum: 10 });
    w.add("a", 1, 0);
    expect(() => w.boost("a", 0, 1)).toThrow(InvalidBoostError);
    expect(() => w.boost("missing", 1, 1)).toThrow(UnknownIdError);
  });

  test("single entry heavier than maxSum rejected", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 10, maxSum: 5 });
    expect(() => w.add("a", 6, 0)).toThrow(CapacityError);
  });

  test("interleaved: slide + boost + shed + cancel", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 10, maxSum: 6 });
    w.add("a", 3, 0);
    clock.advance(5);
    w.add("b", 3, 2);
    w.boost("b", 1, 20);
    // sum effective 3+4=7 > 6 → shed a
    expect(w.inWindowIds()).toEqual(["b"]);
    expect(w.sum()).toBe(4);
    clock.advance(5);
    // b still in (ts=5, now=10, 10-5<10); boost still active
    expect(w.sum()).toBe(4);
    expect(w.cancel("b")).toBe(true);
    expect(w.add("c", 6, 1).shed).toEqual([]);
  });

  test("interleaved: multi boost expiry order and re-admit", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 100, maxSum: 8 });
    w.add("x", 2, 1);
    w.add("y", 2, 1);
    w.boost("x", 2, 4);
    w.boost("y", 2, 8);
    expect(w.sum()).toBe(8);
    clock.advance(4);
    const d1 = w.drive();
    expect(d1.expiredBoosts).toEqual([1]);
    expect(w.sum()).toBe(6);
    expect(w.add("z", 2, 0).shed).toEqual([]);
    clock.advance(4);
    const d2 = w.drive();
    expect(d2.expiredBoosts).toEqual([2]);
  });

  test("interleaved: priority shed prefers lower priority over older higher", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 50, maxSum: 4 });
    w.add("old", 2, 5);
    clock.advance(1);
    w.add("newLow", 2, 0);
    const r = w.add("hi", 3, 9);
    // need shed 3: newLow (pri 0) then old? 2+2+3=7, shed newLow →5, shed old →3
    expect(r.shed[0]).toBe("newLow");
    expect(r.shed).toContain("old");
    expect(w.ids()).toEqual(["hi"]);
  });

  test("interleaved: stale not in sum; queries keep id until mutate/drive", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 3, maxSum: 5 });
    w.add("a", 5, 0);
    clock.advance(3);
    expect(w.sum()).toBe(0);
    expect(w.size()).toBe(1);
    expect(w.weightOf("a")).toBe(5);
    // add expires/purges stale then reuses id
    expect(w.add("a", 5, 0).status).toBe("accepted");
    expect(w.sum()).toBe(5);
  });

  test("interleaved: boost then self-shed by lower priority newcomer", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 40, maxSum: 5 });
    w.add("keep", 2, 10);
    w.add("victim", 2, 0);
    w.boost("keep", 1, 30);
    expect(w.sum()).toBe(5);
    const r = w.add("mid", 2, 1);
    // 5+2=7 → shed victim (pri0) →5; still need? 2+1+2 wait keep3+mid2=5 after victim gone
    expect(r.shed).toEqual(["victim"]);
    expect(w.sum()).toBe(5);
  });

  test("weightOf vs effectiveWeightOf; cancel false after purge", () => {
    const clock = new VirtualClock();
    const w = new WeightWin({ clock, windowMs: 2, maxSum: 10 });
    w.add("x", 3, 0);
    w.boost("x", 4, 10);
    expect(w.weightOf("x")).toBe(3);
    expect(w.effectiveWeightOf("x")).toBe(7);
    clock.advance(2);
    expect(w.cancel("x")).toBe(false);
    expect(w.size()).toBe(0);
  });
});
