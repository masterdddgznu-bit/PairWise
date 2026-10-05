import {
  CapacityError,
  DedupeQ,
  DuplicateRecentError,
  InvalidConfigError,
  InvalidIdError,
  PoisonedError,
  VirtualClock,
} from "../src/index.js";

describe("dedupeq hell 0-1", () => {
  test("rejects invalid config and ids", () => {
    const clock = new VirtualClock();
    expect(() => new DedupeQ({ clock, windowMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new DedupeQ({ clock, windowMs: 1, poisonMs: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new DedupeQ({ clock, windowMs: 1, maxQueue: 0 })).toThrow(
      InvalidConfigError,
    );
    const q = new DedupeQ({ clock, windowMs: 10, maxQueue: 2 });
    expect(() => q.enqueue("", 1)).toThrow(InvalidIdError);
    expect(() => q.poison("")).toThrow(InvalidIdError);
  });

  test("enqueue FIFO pop; in-queue update keeps position", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 100, maxQueue: 8 });
    expect(q.enqueue("a", 1).status).toBe("accepted");
    expect(q.enqueue("b", 2).status).toBe("accepted");
    expect(q.enqueue("a", 9).status).toBe("updated");
    expect(q.ids()).toEqual(["a", "b"]);
    expect(q.peek()).toEqual({ id: "a", payload: 9 });
    expect(q.pop()).toEqual({ id: "a", payload: 9 });
    expect(q.pop()).toEqual({ id: "b", payload: 2 });
  });

  test("recent pop blocks re-enqueue until window elapses", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 10, maxQueue: 8 });
    q.enqueue("a", 1);
    q.pop();
    expect(() => q.enqueue("a", 2)).toThrow(DuplicateRecentError);
    clock.advance(9);
    expect(() => q.enqueue("a", 2)).toThrow(DuplicateRecentError);
    clock.advance(1);
    expect(q.enqueue("a", 2).status).toBe("accepted");
  });

  test("poison blocks enqueue until clearPoison", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 100, poisonMs: 50, maxQueue: 8 });
    q.poison("a");
    expect(q.isPoisoned("a")).toBe(true);
    expect(() => q.enqueue("a", 1)).toThrow(PoisonedError);
    expect(q.clearPoison("a")).toBe(true);
    expect(q.isPoisoned("a")).toBe(false);
    expect(q.enqueue("a", 1).status).toBe("accepted");
  });

  test("poison TTL expires via drive and enqueue lazy sweep", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 100, poisonMs: 5, maxQueue: 8 });
    q.poison("a");
    clock.advance(5);
    expect(q.isPoisoned("a")).toBe(false);
    expect(q.poisonedAtOf("a")).toBe(0);
    expect(q.drive().detoxed).toEqual(["a"]);
    expect(q.poisonedAtOf("a")).toBeNull();
    q.poison("b");
    clock.advance(5);
    expect(q.enqueue("b", 1).status).toBe("accepted");
  });

  test("in-queue update allowed even when poisoned", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 10, poisonMs: 10, maxQueue: 8 });
    q.enqueue("a", 1);
    q.poison("a");
    expect(q.enqueue("a", 9).status).toBe("updated");
    expect(q.peek()?.payload).toBe(9);
  });

  test("poison takes precedence over recent when both apply after leave", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 20, poisonMs: 20, maxQueue: 8 });
    q.enqueue("a", 1);
    q.pop();
    q.poison("a");
    expect(() => q.enqueue("a", 2)).toThrow(PoisonedError);
  });

  test("cancel writes recent; missing cancel false", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 10, maxQueue: 8 });
    q.enqueue("a", 1);
    q.enqueue("b", 2);
    expect(q.cancel("a")).toBe(true);
    expect(q.ids()).toEqual(["b"]);
    expect(() => q.enqueue("a", 9)).toThrow(DuplicateRecentError);
    expect(q.cancel("a")).toBe(false);
  });

  test("capacity only counts queue not recent/poison", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 100, maxQueue: 2 });
    q.enqueue("a", 1);
    q.enqueue("b", 2);
    expect(() => q.enqueue("c", 3)).toThrow(CapacityError);
    q.pop();
    q.poison("z");
    expect(() => q.enqueue("a", 9)).toThrow(DuplicateRecentError);
    expect(q.enqueue("c", 3).status).toBe("accepted");
  });

  test("drive forgets recent and detoxes poison in sorted order", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 5, poisonMs: 5, maxQueue: 8 });
    q.enqueue("b", 1);
    q.enqueue("a", 2);
    q.pop(); // b at 0
    clock.advance(1);
    q.pop(); // a at 1
    q.poison("z"); // at 1
    clock.advance(1);
    q.poison("m"); // at 2
    clock.advance(5); // now=7
    const d = q.drive();
    expect(d.forgotten).toEqual(["b", "a"]);
    expect(d.detoxed).toEqual(["z", "m"]); // z at 1, m at 2
  });

  test("drive detox order time then id", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 1, poisonMs: 1, maxQueue: 8 });
    q.poison("z");
    q.poison("a");
    q.poison("m");
    clock.advance(1);
    expect(q.drive().detoxed).toEqual(["a", "m", "z"]);
  });

  test("recentIds ignores expired; completedAtOf keeps stale ts", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 3, maxQueue: 4 });
    q.enqueue("x", 1);
    q.pop();
    clock.advance(3);
    expect(q.recentIds()).toEqual([]);
    expect(q.completedAtOf("x")).toBe(0);
  });

  test("interleaved cancel pop poison window capacity", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 4, poisonMs: 4, maxQueue: 2 });
    q.enqueue("a", 1);
    q.enqueue("b", 2);
    expect(q.cancel("a")).toBe(true);
    q.poison("c");
    expect(() => q.enqueue("c", 3)).toThrow(PoisonedError);
    expect(q.clearPoison("c")).toBe(true);
    expect(q.enqueue("c", 3).status).toBe("accepted");
    expect(q.pop()?.id).toBe("b");
    clock.advance(4);
    expect(q.enqueue("a", 9).status).toBe("accepted");
    expect(q.ids()).toEqual(["c", "a"]);
  });

  test("interleaved drive after mixed recent and poison", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 3, poisonMs: 6, maxQueue: 4 });
    q.enqueue("a", 1);
    q.pop();
    q.poison("p");
    clock.advance(3);
    const d1 = q.drive();
    expect(d1.forgotten).toEqual(["a"]);
    expect(d1.detoxed).toEqual([]);
    expect(q.isPoisoned("p")).toBe(true);
    clock.advance(3);
    expect(q.drive().detoxed).toEqual(["p"]);
  });

  test("interleaved update does not clear foreign recent or poison", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 10, poisonMs: 10, maxQueue: 8 });
    q.enqueue("a", 1);
    q.pop();
    q.poison("p");
    q.enqueue("b", 2);
    expect(q.enqueue("b", 3).status).toBe("updated");
    expect(() => q.enqueue("a", 9)).toThrow(DuplicateRecentError);
    expect(() => q.enqueue("p", 1)).toThrow(PoisonedError);
  });

  test("default maxQueue 16; default poisonMs equals windowMs", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 7 });
    for (let i = 0; i < 16; i++) q.enqueue(`k${i}`, i);
    expect(() => q.enqueue("x", 1)).toThrow(CapacityError);
    q.pop(); // free a slot
    q.poison("z");
    expect(() => q.enqueue("z", 1)).toThrow(PoisonedError);
    clock.advance(7);
    expect(q.enqueue("z", 1).status).toBe("accepted");
  });

  test("exact window boundary allows re-enqueue", () => {
    const clock = new VirtualClock();
    const q = new DedupeQ({ clock, windowMs: 7, maxQueue: 4 });
    q.enqueue("a", 1);
    q.pop();
    clock.advance(7);
    expect(q.enqueue("a", 2).status).toBe("accepted");
  });
});
