import {
  VirtualClock,
  IdemBox,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  StateError,
} from "../src/index.js";

function rt(b: IdemBox, clock: VirtualClock, opts: { idemTtlMs: number; maxTopics?: number; maxDepth?: number; maxIdem?: number }) {
  return IdemBox.fromJournal(clock, opts, b.journal());
}

describe("idembox hell+", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new IdemBox({ clock, idemTtlMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new IdemBox({ clock, idemTtlMs: 1, maxTopics: 0 })).toThrow(InvalidConfigError);
  });

  test("publish poll commit happy path", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 100 });
    expect(b.publish("t", "k1", "A")).toEqual({ seq: 1, duplicate: false });
    expect(b.poll("g", "t", 10)).toEqual([{ seq: 1, idemKey: "k1", payload: "A" }]);
    b.commit("g", "t", 1);
    expect(b.poll("g", "t", 10)).toEqual([]);
    expect(b.offsetOf("g", "t")).toBe(1);
  });

  test("duplicate publish returns same seq and does not deepen", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    expect(b.publish("t", "k", 1).duplicate).toBe(false);
    expect(b.publish("t", "k", 2)).toEqual({ seq: 1, duplicate: true });
    expect(b.depth("t")).toBe(1);
    expect(b.journal().some((e) => e.type === "dup")).toBe(true);
  });

  test("after idem expire, same key publishes new seq", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 10 });
    expect(b.publish("t", "k", "a").seq).toBe(1);
    clock.advance(10);
    expect(b.drive().expired).toEqual([{ topic: "t", idemKey: "k" }]);
    expect(b.publish("t", "k", "b")).toEqual({ seq: 2, duplicate: false });
    expect(b.depth("t")).toBe(2);
  });

  test("commit cannot regress or pass head", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    b.publish("t", "a", 1);
    b.publish("t", "b", 2);
    b.commit("g", "t", 2);
    expect(() => b.commit("g", "t", 1)).toThrow(StateError);
    expect(() => b.commit("g", "t", 3)).toThrow(StateError);
  });

  test("topic and depth capacity", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50, maxTopics: 1, maxDepth: 1 });
    b.publish("t1", "k", 1);
    expect(() => b.publish("t2", "k", 1)).toThrow(CapacityError);
    expect(() => b.publish("t1", "k2", 2)).toThrow(CapacityError);
  });

  test("idem capacity", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50, maxIdem: 1, maxDepth: 8 });
    b.publish("t", "a", 1);
    expect(() => b.publish("t", "b", 2)).toThrow(CapacityError);
  });

  test("fromJournal restores queue offsets and idem", () => {
    const clock = new VirtualClock();
    const opts = { idemTtlMs: 40, maxTopics: 4, maxDepth: 8, maxIdem: 16 };
    const b = new IdemBox({ clock, ...opts });
    b.publish("t", "k1", "A");
    b.publish("t", "k2", "B");
    b.commit("g", "t", 1);
    const r = rt(b, clock, opts);
    expect(r.depth("t")).toBe(2);
    expect(r.offsetOf("g", "t")).toBe(1);
    expect(r.poll("g", "t", 10).map((m) => m.seq)).toEqual([2]);
    expect(r.publish("t", "k1", "Z")).toEqual({ seq: 1, duplicate: true });
  });

  test("interleaved: two groups independent offsets", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    b.publish("t", "a", 1);
    b.publish("t", "b", 2);
    b.commit("g1", "t", 1);
    expect(b.poll("g1", "t", 10).map((m) => m.seq)).toEqual([2]);
    expect(b.poll("g2", "t", 10).map((m) => m.seq)).toEqual([1, 2]);
  });

  test("interleaved: poll maxn truncates", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    b.publish("t", "a", 1);
    b.publish("t", "b", 2);
    b.publish("t", "c", 3);
    expect(b.poll("g", "t", 2).map((m) => m.seq)).toEqual([1, 2]);
  });

  test("interleaved: equal commit idempotent", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    b.publish("t", "a", 1);
    b.commit("g", "t", 1);
    const n = b.journal().length;
    b.commit("g", "t", 1);
    expect(b.offsetOf("g", "t")).toBe(1);
    expect(b.journal().length).toBe(n + 1);
  });

  test("interleaved: drive empty when nothing expired", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 20 });
    b.publish("t", "a", 1);
    clock.advance(5);
    const n = b.journal().length;
    expect(b.drive().expired).toEqual([]);
    expect(b.journal().length).toBe(n);
  });

  test("interleaved: recover after expire allows new publish", () => {
    const clock = new VirtualClock();
    const opts = { idemTtlMs: 5, maxDepth: 8, maxIdem: 8 };
    const b = new IdemBox({ clock, ...opts });
    b.publish("t", "k", "old");
    clock.advance(5);
    b.drive();
    const r = rt(b, clock, opts);
    expect(r.publish("t", "k", "new")).toEqual({ seq: 2, duplicate: false });
  });

  test("interleaved: failed depth does not wal", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50, maxDepth: 1 });
    b.publish("t", "a", 1);
    const n = b.journal().length;
    expect(() => b.publish("t", "b", 2)).toThrow(CapacityError);
    expect(b.journal().length).toBe(n);
  });

  test("interleaved: multi-topic order of topics()", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    b.publish("b", "k", 1);
    b.publish("a", "k", 1);
    expect(b.topics()).toEqual(["b", "a"]);
  });

  test("interleaved: commit requires existing messages", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    expect(() => b.commit("g", "t", 1)).toThrow(StateError);
  });

  test("hidden: duplicate still audits dup even when payload differs", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    b.publish("t", "k", "first");
    b.publish("t", "k", "second");
    expect(b.poll("g", "t", 10)[0].payload).toBe("first");
  });

  test("hidden: expire sorts by topic then idemKey", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 3 });
    b.publish("b", "z", 1);
    b.publish("a", "m", 1);
    b.publish("a", "a", 1);
    clock.advance(3);
    expect(b.drive().expired).toEqual([
      { topic: "a", idemKey: "a" },
      { topic: "a", idemKey: "m" },
      { topic: "b", idemKey: "z" },
    ]);
  });

  test("invalid args", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 10 });
    expect(() => b.publish("", "k", 1)).toThrow(InvalidArgError);
    expect(() => b.poll("g", "t", 0)).toThrow(InvalidArgError);
  });

  test("fromJournal preserves dup history length", () => {
    const clock = new VirtualClock();
    const opts = { idemTtlMs: 50 };
    const b = new IdemBox({ clock, ...opts });
    b.publish("t", "k", 1);
    b.publish("t", "k", 1);
    const r = rt(b, clock, opts);
    expect(r.journal().filter((e) => e.type === "dup")).toHaveLength(1);
  });

  test("interleaved: poll after partial commit", () => {
    const clock = new VirtualClock();
    const b = new IdemBox({ clock, idemTtlMs: 50 });
    b.publish("t", "a", 1);
    b.publish("t", "b", 2);
    b.publish("t", "c", 3);
    b.commit("g", "t", 2);
    expect(b.poll("g", "t", 10).map((m) => m.seq)).toEqual([3]);
  });
});
