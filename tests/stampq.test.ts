import {
  CapacityError,
  IllegalOpError,
  InvalidConfigError,
  InvalidStampError,
  StampQ,
  UnknownIdError,
  VirtualClock,
} from "../src/index.js";

function setup(opts?: { maxItems?: number; initialWatermark?: number }) {
  const clock = new VirtualClock();
  const q = new StampQ({ clock, ...opts });
  return { clock, q };
}

describe("stampq hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new StampQ({ clock, maxItems: 0 })).toThrow(InvalidConfigError);
  });

  test("offer capacity and duplicate", () => {
    const { q } = setup({ maxItems: 1 });
    expect(q.offer("a", 1)).toEqual({ status: "accepted" });
    expect(() => q.offer("a", 2)).toThrow(IllegalOpError);
    expect(() => q.offer("b", 1)).toThrow(CapacityError);
  });

  test("unstamped not releasable until stamp and watermark", () => {
    const { q } = setup({ initialWatermark: 10 });
    q.offer("a", "x");
    expect(q.isReleasable("a")).toBe(false);
    expect(q.peek()).toBeNull();
    q.stamp("a", 5);
    expect(q.isReleasable("a")).toBe(true);
    expect(q.pop()?.id).toBe("a");
  });

  test("stamp errors", () => {
    const { q } = setup();
    expect(() => q.stamp("missing", 1)).toThrow(UnknownIdError);
    q.offer("a", 1);
    expect(() => q.stamp("a", 1.5)).toThrow(InvalidStampError);
    q.stamp("a", 1);
    expect(() => q.stamp("a", 2)).toThrow(IllegalOpError);
  });

  test("watermark no regress", () => {
    const { q } = setup({ initialWatermark: 0 });
    expect(q.advanceWatermark(5)).toBe(5);
    expect(() => q.advanceWatermark(4)).toThrow(IllegalOpError);
    expect(q.advanceWatermark(5)).toBe(5);
  });

  test("restamp can push above watermark", () => {
    const { q } = setup({ initialWatermark: 10 });
    q.offer("a", 1);
    q.stamp("a", 3);
    expect(q.isReleasable("a")).toBe(true);
    q.restamp("a", 20);
    expect(q.isReleasable("a")).toBe(false);
    expect(q.peek()).toBeNull();
    q.advanceWatermark(20);
    expect(q.pop()?.stamp).toBe(20);
  });

  test("tie-break by stamp event seq not offer order", () => {
    const { clock, q } = setup({ initialWatermark: 100 });
    q.offer("a", 1);
    q.offer("b", 1);
    clock.advance(1);
    q.stamp("b", 5);
    clock.advance(1);
    q.stamp("a", 5);
    // same stamp; b stamped earlier in log -> b first
    expect(q.peek()?.id).toBe("b");
    expect(q.pop()?.id).toBe("b");
    expect(q.pop()?.id).toBe("a");
  });

  test("events log order matches mutations", () => {
    const { clock, q } = setup();
    q.offer("a", 1);
    clock.advance(2);
    q.stamp("a", 1);
    q.advanceWatermark(1);
    q.pop();
    expect(q.events().map((e) => e.type)).toEqual([
      "offer",
      "stamp",
      "watermark",
      "pop",
    ]);
    expect(q.events()[1]!.at).toBe(2);
  });

  test("cancel frees capacity for unstamped", () => {
    const { q } = setup({ maxItems: 1 });
    q.offer("a", 1);
    expect(q.cancel("a")).toBe(true);
    expect(q.offer("b", 1)).toEqual({ status: "accepted" });
    expect(q.events().map((e) => e.type)).toContain("cancel");
  });

  test("drive snapshot drains all releasable at start wm", () => {
    const { q } = setup({ initialWatermark: 5 });
    q.offer("a", 1);
    q.offer("b", 1);
    q.offer("c", 1);
    q.stamp("a", 1);
    q.stamp("b", 5);
    q.stamp("c", 9);
    const { drained } = q.drive();
    expect(drained.map((d) => d.id)).toEqual(["a", "b"]);
    expect(q.ids()).toEqual(["c"]);
  });

  test("unstamped occupies capacity blocking offer", () => {
    const { q } = setup({ maxItems: 2, initialWatermark: 10 });
    q.offer("a", 1);
    q.offer("b", 1);
    q.stamp("a", 1);
    expect(() => q.offer("c", 1)).toThrow(CapacityError);
    q.pop();
    expect(q.offer("c", 1)).toEqual({ status: "accepted" });
  });

  test("restamp on unstamped illegal", () => {
    const { q } = setup();
    q.offer("a", 1);
    expect(() => q.restamp("a", 1)).toThrow(IllegalOpError);
  });

  test("multi-step: watermark advance unlocks after restamp conflict", () => {
    const { clock, q } = setup({ initialWatermark: 0 });
    q.offer("x", "x");
    q.offer("y", "y");
    q.stamp("x", 2);
    q.stamp("y", 1);
    expect(q.drive().drained).toEqual([]);
    q.advanceWatermark(1);
    expect(q.pop()?.id).toBe("y");
    clock.advance(1);
    q.restamp("x", 1);
    // x stamp 1 <= wm 1, releasable; stampEventSeq from restamp
    expect(q.pop()?.id).toBe("x");
  });

  test("multi-step: cancel stamped mid-queue and log consistency", () => {
    const { q } = setup({ initialWatermark: 10 });
    q.offer("a", 1);
    q.offer("b", 1);
    q.stamp("a", 3);
    q.stamp("b", 3);
    expect(q.cancel("a")).toBe(true);
    expect(q.pop()?.id).toBe("b");
    expect(q.events().filter((e) => e.type === "cancel")[0]!.id).toBe("a");
  });

  test("multi-step: equal stamps restamp reorders by new event seq", () => {
    const { q } = setup({ initialWatermark: 10 });
    q.offer("a", 1);
    q.offer("b", 1);
    q.stamp("a", 4);
    q.stamp("b", 4);
    expect(q.peek()?.id).toBe("a");
    q.restamp("a", 4);
    // a restamp gets newer seq -> b wins
    expect(q.peek()?.id).toBe("b");
    expect(q.drive().drained.map((d) => d.id)).toEqual(["b", "a"]);
  });

  test("multi-step: illegal watermark regress does not append success semantics", () => {
    const { q } = setup({ initialWatermark: 3 });
    q.offer("a", 1);
    q.stamp("a", 3);
    const before = q.events().length;
    expect(() => q.advanceWatermark(1)).toThrow(IllegalOpError);
    // advance throws before append in our impl — length unchanged
    expect(q.events().length).toBe(before);
    expect(q.pop()?.id).toBe("a");
  });

  test("multi-step: drive then stamp late item needs new wm", () => {
    const { q } = setup({ initialWatermark: 2 });
    q.offer("early", 1);
    q.stamp("early", 2);
    q.offer("late", 1);
    expect(q.drive().drained.map((d) => d.id)).toEqual(["early"]);
    q.stamp("late", 5);
    expect(q.pop()).toBeNull();
    q.advanceWatermark(5);
    expect(q.pop()?.id).toBe("late");
  });
});
