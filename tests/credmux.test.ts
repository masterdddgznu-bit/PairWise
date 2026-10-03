import {
  VirtualClock,
  CredMux,
  InvalidConfigError,
  UnknownStreamError,
  StreamClosedError,
  FenceError,
  StreamLimitError,
  InvalidRequestError,
} from "../src/index.js";

function mx(
  o: Partial<{
    initialCredit: number;
    maxCredit: number;
    idleTimeoutMs: number;
    maxStreams: number;
    maxPending: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const m = new CredMux({
    clock,
    initialCredit: o.initialCredit ?? 1,
    maxCredit: o.maxCredit ?? 3,
    idleTimeoutMs: o.idleTimeoutMs ?? 50,
    maxStreams: o.maxStreams ?? 8,
    maxPending: o.maxPending ?? 2,
  });
  return { clock, m };
}

describe("credmux hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new CredMux({
          clock,
          initialCredit: 2,
          maxCredit: 1,
          idleTimeoutMs: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new CredMux({
          clock,
          initialCredit: 0,
          maxCredit: 1,
          idleTimeoutMs: 0,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("open send poll with credit", () => {
    const { m } = mx({ initialCredit: 2 });
    const { gen, credit } = m.open("a");
    expect(credit).toBe(2);
    const r = m.send("a", gen, "x");
    expect(r).toEqual({ status: "sent", seq: 1, credit: 1 });
    expect(m.poll("a", gen)).toEqual([{ seq: 1, payload: "x" }]);
    expect(m.queuedOf("a")).toBe(0);
  });

  test("send pending when no credit; grant flushes FIFO", () => {
    const { m } = mx({ initialCredit: 0, maxCredit: 2, maxPending: 3 });
    const { gen } = m.open("s");
    expect(m.send("s", gen, "a")).toEqual({ status: "pending", pending: 1 });
    expect(m.send("s", gen, "b")).toEqual({ status: "pending", pending: 2 });
    expect(m.grant("s", gen, 2)).toBe(0);
    expect(m.poll("s", gen)).toEqual([
      { seq: 1, payload: "a" },
      { seq: 2, payload: "b" },
    ]);
  });

  test("grant caps at maxCredit", () => {
    const { m } = mx({ initialCredit: 1, maxCredit: 2 });
    const { gen } = m.open("s");
    expect(m.grant("s", gen, 10)).toBe(2);
  });

  test("pending full errors", () => {
    const { m } = mx({ initialCredit: 0, maxPending: 1 });
    const { gen } = m.open("s");
    m.send("s", gen, "a");
    expect(() => m.send("s", gen, "b")).toThrow(InvalidRequestError);
  });

  test("fence and closed errors", () => {
    const { m } = mx();
    const { gen } = m.open("s");
    expect(() => m.send("s", gen + 1, "x")).toThrow(FenceError);
    expect(m.close("s", gen)).toBe(true);
    expect(m.close("s", gen)).toBe(false);
    expect(() => m.send("s", gen, "x")).toThrow(StreamClosedError);
    expect(() => m.poll("s", gen)).toThrow(StreamClosedError);
    expect(m.creditOf("s")).toBe(0);
  });

  test("re-open bumps gen; old gen fenced", () => {
    const { m } = mx();
    const a = m.open("s");
    m.close("s", a.gen);
    const b = m.open("s");
    expect(b.gen).toBe(a.gen + 1);
    expect(() => m.send("s", a.gen, "x")).toThrow(FenceError);
    expect(m.send("s", b.gen, "ok").status).toBe("sent");
  });

  test("reset clears queues and bumps gen", () => {
    const { m } = mx({ initialCredit: 0, maxPending: 2 });
    const { gen } = m.open("s");
    m.send("s", gen, "p");
    const g2 = m.reset("s", gen);
    expect(g2).toBe(gen + 1);
    expect(m.pendingOf("s")).toBe(0);
    expect(m.creditOf("s")).toBe(0);
    expect(() => m.send("s", gen, "x")).toThrow(FenceError);
  });

  test("stream limit", () => {
    const { m } = mx({ maxStreams: 2, initialCredit: 1 });
    m.open("a");
    m.open("b");
    expect(() => m.open("c")).toThrow(StreamLimitError);
    m.close("a", 1);
    expect(m.open("c").gen).toBe(1);
  });

  test("idle timeout closes via drive", () => {
    const { clock, m } = mx({ idleTimeoutMs: 10, initialCredit: 1 });
    const { gen } = m.open("s");
    m.send("s", gen, "x");
    clock.advance(10);
    expect(m.drive()).toEqual({ idleClosed: ["s"] });
    expect(m.openIds()).toEqual([]);
    expect(() => m.poll("s", gen)).toThrow(StreamClosedError);
  });

  test("activity refreshes idle timer", () => {
    const { clock, m } = mx({ idleTimeoutMs: 10 });
    const { gen } = m.open("s");
    clock.advance(9);
    m.grant("s", gen, 1);
    clock.advance(9);
    expect(m.drive()).toEqual({ idleClosed: [] });
    clock.advance(1);
    expect(m.drive().idleClosed).toEqual(["s"]);
  });

  test("unknown stream", () => {
    const { m } = mx();
    expect(() => m.creditOf("nope")).toThrow(UnknownStreamError);
  });

  test("poll maxn and openIds sorted", () => {
    const { m } = mx({ initialCredit: 3 });
    m.open("b");
    m.open("a");
    expect(m.openIds()).toEqual(["a", "b"]);
    const g = m.genOf("a");
    m.send("a", g, "1");
    m.send("a", g, "2");
    m.send("a", g, "3");
    expect(m.poll("a", g, 2)).toEqual([
      { seq: 1, payload: "1" },
      { seq: 2, payload: "2" },
    ]);
    expect(m.poll("a", g)).toEqual([{ seq: 3, payload: "3" }]);
  });

  test("interleaved multi-stream pending and grants", () => {
    const { m } = mx({
      initialCredit: 0,
      maxCredit: 2,
      maxPending: 4,
      idleTimeoutMs: 1000,
    });
    const a = m.open("a");
    const b = m.open("b");
    m.send("a", a.gen, "a1");
    m.send("b", b.gen, "b1");
    m.send("a", a.gen, "a2");
    expect(m.grant("b", b.gen, 1)).toBe(0);
    expect(m.poll("b", b.gen)).toEqual([{ seq: 1, payload: "b1" }]);
    expect(m.pendingOf("a")).toBe(2);
    expect(m.grant("a", a.gen, 2)).toBe(0);
    expect(m.poll("a", a.gen).map((x) => x.payload)).toEqual(["a1", "a2"]);
  });

  test("close drops pending and queued", () => {
    const { m } = mx({ initialCredit: 1, maxPending: 2 });
    const { gen } = m.open("s");
    m.send("s", gen, "q"); // queued
    m.send("s", gen, "p"); // pending
    m.close("s", gen);
    expect(m.queuedOf("s")).toBe(0);
    expect(m.pendingOf("s")).toBe(0);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("duplicate open while live fails", () => {
    const { m } = mx();
    m.open("s");
    expect(() => m.open("s")).toThrow(InvalidRequestError);
  });
});
