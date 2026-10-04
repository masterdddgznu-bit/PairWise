import {
  VirtualClock,
  OrderMux,
  InvalidConfigError,
  UnknownStreamError,
  StreamClosedError,
  FenceError,
  InvalidSeqError,
  StreamLimitError,
} from "../src/index.js";

function mx(
  o: Partial<{ bufSize: number; gapTimeoutMs: number; maxStreams: number }> = {},
) {
  const clock = new VirtualClock();
  const m = new OrderMux({
    clock,
    bufSize: o.bufSize ?? 2,
    gapTimeoutMs: o.gapTimeoutMs ?? 10,
    maxStreams: o.maxStreams ?? 8,
  });
  return { clock, m };
}

describe("ordermux hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new OrderMux({ clock, bufSize: 0, gapTimeoutMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new OrderMux({ clock, bufSize: 1, gapTimeoutMs: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("in-order push delivers to poll", () => {
    const { m } = mx();
    const { gen } = m.open("a");
    expect(m.push("a", gen, 1, "x")).toBe("delivered");
    expect(m.push("a", gen, 2, "y")).toBe("delivered");
    expect(m.poll()).toEqual([
      { streamId: "a", seq: 1, payload: "x" },
      { streamId: "a", seq: 2, payload: "y" },
    ]);
  });

  test("out-of-order buffer then fill", () => {
    const { m } = mx({ bufSize: 3 });
    const { gen } = m.open("s");
    expect(m.push("s", gen, 3, "c")).toBe("buffered");
    expect(m.push("s", gen, 2, "b")).toBe("buffered");
    expect(m.poll()).toEqual([]);
    expect(m.push("s", gen, 1, "a")).toBe("delivered");
    expect(m.poll()).toEqual([
      { streamId: "s", seq: 1, payload: "a" },
      { streamId: "s", seq: 2, payload: "b" },
      { streamId: "s", seq: 3, payload: "c" },
    ]);
  });

  test("duplicate and drop when full", () => {
    const { m } = mx({ bufSize: 1 });
    const { gen } = m.open("s");
    expect(m.push("s", gen, 2, "b")).toBe("buffered");
    expect(m.push("s", gen, 2, "b2")).toBe("duplicate");
    expect(m.push("s", gen, 3, "c")).toBe("dropped");
    expect(m.push("s", gen, 1, "a")).toBe("delivered");
    expect(m.poll().map((x) => x.seq)).toEqual([1, 2]);
    expect(m.push("s", gen, 1, "a")).toBe("duplicate");
  });

  test("gap timeout skips missing seq", () => {
    const { clock, m } = mx({ gapTimeoutMs: 5, bufSize: 2 });
    const { gen } = m.open("s");
    expect(m.push("s", gen, 2, "b")).toBe("buffered");
    clock.advance(5);
    expect(m.drive()).toEqual({ skipped: [{ streamId: "s", seq: 1 }] });
    expect(m.nextOf("s")).toBe(3);
    expect(m.poll()).toEqual([{ streamId: "s", seq: 2, payload: "b" }]);
  });

  test("gap timer starts on first buffered higher seq", () => {
    const { clock, m } = mx({ gapTimeoutMs: 10, bufSize: 3 });
    const { gen } = m.open("s");
    clock.advance(3);
    m.push("s", gen, 2, "b"); // gapSince=3
    clock.advance(9);
    expect(m.drive().skipped).toEqual([]); // 3+10=13, now=12
    clock.advance(1);
    expect(m.drive().skipped).toEqual([{ streamId: "s", seq: 1 }]);
  });

  test("multi-stream interleave delivery order", () => {
    const { m } = mx();
    const a = m.open("a");
    const b = m.open("b");
    m.push("b", b.gen, 1, "b1");
    m.push("a", a.gen, 1, "a1");
    expect(m.poll()).toEqual([
      { streamId: "b", seq: 1, payload: "b1" },
      { streamId: "a", seq: 1, payload: "a1" },
    ]);
  });

  test("fence close reset reopen", () => {
    const { m } = mx();
    const { gen } = m.open("s");
    expect(() => m.push("s", gen + 1, 1, "x")).toThrow(FenceError);
    expect(m.close("s", gen)).toBe(true);
    expect(() => m.push("s", gen, 1, "x")).toThrow(StreamClosedError);
    const g2 = m.open("s").gen;
    expect(g2).toBe(gen + 1);
    const g3 = m.reset("s", g2);
    expect(g3).toBe(g2 + 1);
    expect(m.nextOf("s")).toBe(1);
  });

  test("stream limit and openIds", () => {
    const { m } = mx({ maxStreams: 2 });
    m.open("b");
    m.open("a");
    expect(m.openIds()).toEqual(["a", "b"]);
    expect(() => m.open("c")).toThrow(StreamLimitError);
    expect(() => m.nextOf("nope")).toThrow(UnknownStreamError);
  });

  test("duplicate open live fails", () => {
    const { m } = mx();
    m.open("s");
    expect(() => m.open("s")).toThrow(InvalidSeqError);
  });

  test("skip then still gapped resets gapSince to now", () => {
    const { clock, m } = mx({ gapTimeoutMs: 5, bufSize: 3 });
    const { gen } = m.open("s");
    m.push("s", gen, 3, "c"); // missing 1 and 2; gapSince=0
    clock.advance(5);
    const r1 = m.drive();
    expect(r1.skipped).toEqual([{ streamId: "s", seq: 1 }]);
    // next=2, buf has 3, gapSince should be 5 (now)
    expect(m.bufferedOf("s")).toBe(1);
    clock.advance(4);
    expect(m.drive().skipped).toEqual([]);
    clock.advance(1);
    expect(m.drive().skipped).toEqual([{ streamId: "s", seq: 2 }]);
    expect(m.poll()).toEqual([{ streamId: "s", seq: 3, payload: "c" }]);
  });

  test("poll maxn", () => {
    const { m } = mx();
    const { gen } = m.open("s");
    m.push("s", gen, 1, "a");
    m.push("s", gen, 2, "b");
    expect(m.poll(1)).toEqual([{ streamId: "s", seq: 1, payload: "a" }]);
    expect(m.poll()).toEqual([{ streamId: "s", seq: 2, payload: "b" }]);
  });

  test("close clears buffer but keeps prior deliveries", () => {
    const { m } = mx({ bufSize: 2 });
    const { gen } = m.open("s");
    m.push("s", gen, 1, "a");
    m.push("s", gen, 3, "c");
    m.close("s", gen);
    expect(m.bufferedOf("s")).toBe(0);
    expect(m.poll()).toEqual([{ streamId: "s", seq: 1, payload: "a" }]);
  });

  test("interleaved: two streams gaps and skips sorted", () => {
    const { clock, m } = mx({ gapTimeoutMs: 4, bufSize: 2 });
    const a = m.open("a");
    const b = m.open("b");
    m.push("b", b.gen, 2, "b2");
    m.push("a", a.gen, 2, "a2");
    clock.advance(4);
    expect(m.drive().skipped).toEqual([
      { streamId: "a", seq: 1 },
      { streamId: "b", seq: 1 },
    ]);
    // drive 按 streamId 字典序跳过并交付
    expect(m.poll().map((x) => `${x.streamId}:${x.seq}`)).toEqual([
      "a:2",
      "b:2",
    ]);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("invalid seq", () => {
    const { m } = mx();
    const { gen } = m.open("s");
    expect(() => m.push("s", gen, 0, "x")).toThrow(InvalidSeqError);
  });
});
