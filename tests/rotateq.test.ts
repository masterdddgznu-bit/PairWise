import {
  CapacityError,
  DuplicateIdError,
  InvalidArgError,
  InvalidConfigError,
  RotateQ,
  UnknownLaneError,
  VirtualClock,
} from "../src/index.js";

describe("rotateq hell 0-1", () => {
  test("rejects invalid config and args", () => {
    const clock = new VirtualClock();
    expect(() => new RotateQ({ clock, starveMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new RotateQ({ clock, starveMs: 1, maxPerLane: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new RotateQ({ clock, starveMs: 1, defaultCredit: -1 })).toThrow(
      InvalidConfigError,
    );
    const q = new RotateQ({ clock, starveMs: 10 });
    expect(() => q.ensureLane("")).toThrow(InvalidArgError);
    expect(() => q.push("L", "a", 1)).toThrow(UnknownLaneError);
  });

  test("ensure order forms ring; RR pop advances cursor and burns credit", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 1000, maxPerLane: 8 });
    q.ensureLane("a");
    q.ensureLane("b");
    q.ensureLane("c");
    expect(q.lanes()).toEqual(["a", "b", "c"]);
    expect(q.cursor()).toBe("a");
    expect(q.creditOf("a")).toBe(1);
    q.grant("a", 2);
    q.grant("b", 1);
    q.grant("c", 1);
    q.push("a", "a1", 1);
    q.push("b", "b1", 1);
    q.push("c", "c1", 1);
    q.push("a", "a2", 2);
    expect(q.pop()).toEqual({ id: "a1", payload: 1, lane: "a" });
    expect(q.cursor()).toBe("b");
    expect(q.creditOf("a")).toBe(2);
    expect(q.pop()).toEqual({ id: "b1", payload: 1, lane: "b" });
    expect(q.cursor()).toBe("c");
    expect(q.pop()).toEqual({ id: "c1", payload: 1, lane: "c" });
    expect(q.pop()).toEqual({ id: "a2", payload: 2, lane: "a" });
  });

  test("RR skips empty and zero-credit lanes", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({
      clock,
      starveMs: 1000,
      maxPerLane: 8,
      defaultCredit: 0,
    });
    q.ensureLane("a");
    q.ensureLane("b");
    q.ensureLane("c");
    q.grant("a", 1);
    q.grant("c", 1);
    q.push("a", "a1", 1);
    q.push("b", "b1", 1); // no credit
    q.push("c", "c1", 1);
    expect(q.pop()?.id).toBe("a1");
    expect(q.cursor()).toBe("b");
    expect(q.pop()?.id).toBe("c1"); // skip b (0 credit)
    expect(q.cursor()).toBe("a");
    expect(q.pop()).toBeNull(); // b still no credit
    expect(q.cursor()).toBe("a");
    q.grant("b", 1);
    expect(q.pop()?.id).toBe("b1");
  });

  test("starve picks older head even if cursor points elsewhere", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 10, maxPerLane: 8 });
    q.ensureLane("a");
    q.ensureLane("b");
    q.grant("a", 2);
    q.grant("b", 2);
    q.push("b", "b1", 1);
    expect(q.pop()?.id).toBe("b1");
    expect(q.cursor()).toBe("a");
    q.push("a", "a1", 1);
    clock.advance(5);
    q.push("b", "b2", 2);
    clock.advance(5);
    expect(q.pop()).toEqual({ id: "a1", payload: 1, lane: "a" });
    expect(q.cursor()).toBe("b");
  });

  test("two starved: earlier enqueuedAt wins; same time earlier lane", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 5, maxPerLane: 8 });
    q.ensureLane("x");
    q.ensureLane("y");
    q.grant("x", 1);
    q.grant("y", 1);
    q.push("y", "y1", 1);
    q.push("x", "x1", 1);
    clock.advance(5);
    expect(q.pop()?.id).toBe("x1");
    expect(q.cursor()).toBe("y");
  });

  test("starved lane with zero credit is ineligible", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({
      clock,
      starveMs: 5,
      maxPerLane: 8,
      defaultCredit: 0,
    });
    q.ensureLane("a");
    q.ensureLane("b");
    q.grant("b", 1);
    q.push("a", "a1", 1);
    q.push("b", "b1", 1);
    clock.advance(5);
    // a starved but 0 credit; b not starved yet (wait 5, starveMs 5 → starved too!)
    // both waited 5 from t=0 → both starved; only b has credit
    expect(q.pop()?.id).toBe("b1");
    expect(q.creditOf("b")).toBe(0);
  });

  test("duplicate id across lanes; per-lane capacity", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 9, maxPerLane: 1 });
    q.ensureLane("a");
    q.ensureLane("b");
    q.push("a", "id1", 1);
    expect(() => q.push("b", "id1", 2)).toThrow(DuplicateIdError);
    expect(() => q.push("a", "id2", 2)).toThrow(CapacityError);
    q.push("b", "id2", 2);
  });

  test("cancel removes; pop null when none servable keeps cursor", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 9, maxPerLane: 4 });
    q.ensureLane("a");
    q.ensureLane("b");
    q.push("a", "a1", 1);
    expect(q.cancel("a1")).toBe(true);
    expect(q.cursor()).toBe("a");
    expect(q.pop()).toBeNull();
    expect(q.cursor()).toBe("a");
  });

  test("below starve uses RR; at boundary starve triggers", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 7, maxPerLane: 4 });
    q.ensureLane("a");
    q.ensureLane("b");
    q.grant("a", 2);
    q.grant("b", 2);
    q.push("b", "b1", 1);
    q.pop();
    q.push("a", "a1", 1);
    clock.advance(6);
    q.push("b", "b2", 2);
    expect(q.pop()?.id).toBe("a1");
    expect(q.cursor()).toBe("b");
  });

  test("boundary starve triggers over RR", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 7, maxPerLane: 4 });
    q.ensureLane("a");
    q.ensureLane("b");
    q.grant("a", 1);
    q.grant("b", 1);
    q.push("a", "a1", 1);
    clock.advance(7);
    q.push("b", "b1", 1);
    expect(q.pop()?.lane).toBe("a");
    expect(q.cursor()).toBe("b");
    expect(q.pop()?.id).toBe("b1");
  });

  test("interleaved starve RR and credit exhaustion", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({
      clock,
      starveMs: 10,
      maxPerLane: 4,
      defaultCredit: 1,
    });
    q.ensureLane("a");
    q.ensureLane("b");
    q.ensureLane("c");
    q.push("a", "a1", 1);
    q.push("b", "b1", 1);
    q.push("c", "c1", 1);
    expect(q.pop()?.id).toBe("a1");
    expect(q.cursor()).toBe("b");
    expect(q.creditOf("a")).toBe(0);
    clock.advance(10);
    q.push("a", "a2", 2);
    // b,c starved with credit; a has item but 0 credit → ineligible
    expect(q.pop()?.id).toBe("b1");
    expect(q.pop()?.id).toBe("c1");
    expect(q.pop()).toBeNull();
    q.grant("a", 1);
    expect(q.pop()?.id).toBe("a2");
  });

  test("interleaved grant after cancel and RR resume", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({
      clock,
      starveMs: 100,
      maxPerLane: 4,
      defaultCredit: 0,
    });
    q.ensureLane("a");
    q.ensureLane("b");
    q.push("a", "a1", 1);
    q.push("b", "b1", 1);
    expect(q.pop()).toBeNull();
    q.grant("b", 1);
    expect(q.pop()?.id).toBe("b1");
    expect(q.cursor()).toBe("a");
    expect(q.cancel("a1")).toBe(true);
    q.push("a", "a2", 2);
    q.grant("a", 1);
    expect(q.pop()?.id).toBe("a2");
  });

  test("interleaved multi-starve with credit filter", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({
      clock,
      starveMs: 4,
      maxPerLane: 4,
      defaultCredit: 1,
    });
    q.ensureLane("a");
    q.ensureLane("b");
    q.ensureLane("c");
    q.push("a", "a1", 1);
    clock.advance(1);
    q.push("b", "b1", 1);
    clock.advance(1);
    q.push("c", "c1", 1);
    clock.advance(4); // now=6; waits a=6,b=5,c=4 all starved
    q.creditOf("a"); // burn nothing
    // consume a credit first via... actually all have credit 1
    expect(q.pop()?.id).toBe("a1"); // oldest enq
    expect(q.creditOf("a")).toBe(0);
    expect(q.pop()?.id).toBe("b1");
    expect(q.pop()?.id).toBe("c1");
  });

  test("default maxPerLane 8; grant validation", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 1 });
    q.ensureLane("L");
    for (let i = 0; i < 8; i++) q.push("L", `i${i}`, i);
    expect(() => q.push("L", "x", 1)).toThrow(CapacityError);
    expect(() => q.grant("L", 0)).toThrow(InvalidArgError);
    expect(() => q.grant("missing", 1)).toThrow(UnknownLaneError);
  });

  test("enqueuedAtOf and sizeAll", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 9, maxPerLane: 4 });
    q.ensureLane("a");
    clock.advance(3);
    q.push("a", "a1", 1);
    expect(q.enqueuedAtOf("a1")).toBe(3);
    expect(q.enqueuedAtOf("missing")).toBeNull();
    expect(q.sizeAll()).toBe(1);
  });

  test("two starved different times with credits", () => {
    const clock = new VirtualClock();
    const q = new RotateQ({ clock, starveMs: 5, maxPerLane: 8 });
    q.ensureLane("a");
    q.ensureLane("b");
    q.grant("a", 1);
    q.grant("b", 1);
    q.push("a", "a1", 1);
    clock.advance(2);
    q.push("b", "b1", 1);
    clock.advance(5);
    expect(q.pop()?.id).toBe("a1");
  });
});
