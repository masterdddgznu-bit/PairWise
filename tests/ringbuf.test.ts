import {
  VirtualClock,
  RingBuf,
  InvalidConfigError,
  UnknownConsumerError,
  InvalidRequestError,
} from "../src/index.js";

function rb(capacity = 3) {
  const clock = new VirtualClock();
  const r = new RingBuf({ clock, capacity });
  return { clock, r };
}

describe("ringbuf hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new RingBuf({ clock, capacity: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("subscribe empty then publish read", () => {
    const { clock, r } = rb(3);
    const s = r.subscribe("c1");
    expect(s).toEqual({ gen: 1, nextSeq: 1 });
    clock.advance(2);
    expect(r.publish("a")).toMatchObject({
      seq: 1,
      overwritten: null,
      lagged: [],
    });
    expect(r.read("c1", 1)).toEqual([
      { seq: 1, payload: "a", publishedAt: 2 },
    ]);
    expect(r.nextSeqOf("c1")).toBe(2);
  });

  test("subscribe after data starts at oldest", () => {
    const { r } = rb(3);
    r.publish("a");
    r.publish("b");
    const s = r.subscribe("late");
    expect(s.nextSeq).toBe(1);
    expect(r.read("late", 1, 2).map((x) => x.payload)).toEqual(["a", "b"]);
  });

  test("overwrite drops oldest and lags slow consumer", () => {
    const { r } = rb(2);
    const sub = r.subscribe("slow");
    r.publish("a");
    r.publish("b");
    expect(r.size()).toBe(2);
    const p = r.publish("c");
    expect(p.overwritten).toBe(1);
    expect(p.lagged).toEqual(["slow"]);
    expect(r.oldest()).toBe(2);
    expect(r.nextSeqOf("slow")).toBe(2);
    expect(r.read("slow", sub.gen, 2).map((x) => x.seq)).toEqual([2, 3]);
  });

  test("fast consumer not lagged", () => {
    const { r } = rb(2);
    const { gen } = r.subscribe("fast");
    r.publish("a");
    r.read("fast", gen, 1);
    r.publish("b");
    const p = r.publish("c");
    expect(p.overwritten).toBe(1);
    expect(p.lagged).toEqual([]);
    expect(r.nextSeqOf("fast")).toBe(2);
  });

  test("multi consumer lag sorted", () => {
    const { r } = rb(1);
    r.subscribe("b");
    r.subscribe("a");
    r.publish("x");
    const p = r.publish("y");
    expect(p.overwritten).toBe(1);
    expect(p.lagged).toEqual(["a", "b"]);
  });

  test("unsubscribe and resubscribe bumps gen", () => {
    const { r } = rb();
    const s1 = r.subscribe("c");
    r.unsubscribe("c", s1.gen);
    expect(() => r.read("c", s1.gen)).toThrow(UnknownConsumerError);
    const s2 = r.subscribe("c");
    expect(s2.gen).toBe(2);
  });

  test("duplicate subscribe and bad gen", () => {
    const { r } = rb();
    r.subscribe("c");
    expect(() => r.subscribe("c")).toThrow(InvalidRequestError);
    expect(() => r.read("c", 9)).toThrow(InvalidRequestError);
  });

  test("read maxn bounds", () => {
    const { r } = rb(2);
    const { gen } = r.subscribe("c");
    r.publish("a");
    r.publish("b");
    expect(() => r.read("c", gen, 3)).toThrow(InvalidRequestError);
    expect(r.read("c", gen, 2)).toHaveLength(2);
  });

  test("read waits when ahead of newest", () => {
    const { r } = rb();
    const { gen } = r.subscribe("c");
    expect(r.read("c", gen)).toEqual([]);
    r.publish("a");
    expect(r.read("c", gen)[0]!.payload).toBe("a");
  });

  test("oldest newest size consumers", () => {
    const { r } = rb(3);
    expect(r.oldest()).toBeNull();
    expect(r.newest()).toBe(0);
    r.subscribe("z");
    r.subscribe("m");
    expect(r.consumers()).toEqual(["m", "z"]);
    r.publish("a");
    expect(r.oldest()).toBe(1);
    expect(r.newest()).toBe(1);
    expect(r.size()).toBe(1);
  });

  test("interleaved: mid-lag catchup after multiple overwrites", () => {
    const { r } = rb(2);
    const { gen } = r.subscribe("c");
    r.publish("1");
    r.publish("2");
    r.publish("3"); // drop 1, lag to 2
    r.publish("4"); // drop 2, lag to 3
    expect(r.nextSeqOf("c")).toBe(3);
    expect(r.read("c", gen, 2).map((x) => x.payload)).toEqual(["3", "4"]);
    expect(r.oldest()).toBe(3);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("invalid payload", () => {
    const { r } = rb();
    expect(() => r.publish(1 as unknown as string)).toThrow(
      InvalidRequestError,
    );
  });
});
