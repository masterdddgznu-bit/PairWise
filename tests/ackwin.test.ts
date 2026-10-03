import {
  VirtualClock,
  AckWin,
  InvalidConfigError,
  WindowFullError,
  InvalidSeqError,
  StaleEpochError,
  ClosedError,
} from "../src/index.js";

function aw(
  o: Partial<{
    windowSize: number;
    rtoMs: number;
    maxRetx: number;
    recvBufSize: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const w = new AckWin({
    clock,
    windowSize: o.windowSize ?? 2,
    rtoMs: o.rtoMs ?? 10,
    maxRetx: o.maxRetx ?? 2,
    recvBufSize: o.recvBufSize ?? 2,
  });
  return { clock, w };
}

describe("ackwin hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new AckWin({
          clock,
          windowSize: 0,
          rtoMs: 1,
          maxRetx: 0,
          recvBufSize: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new AckWin({
          clock,
          windowSize: 1,
          rtoMs: 1,
          maxRetx: -1,
          recvBufSize: 1,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("send fills window then WindowFullError; ack frees", () => {
    const { w } = aw({ windowSize: 2 });
    expect(w.send("a").seq).toBe(1);
    expect(w.send("b").seq).toBe(2);
    expect(() => w.send("c")).toThrow(WindowFullError);
    expect(w.ack(1, 1)).toBe(true);
    expect(w.inFlight()).toBe(1);
    expect(w.send("c").seq).toBe(3);
  });

  test("cumulative ack ignores older; rejects bad cumAck", () => {
    const { w } = aw({ windowSize: 4 });
    w.send("a");
    w.send("b");
    expect(w.ack(1, 2)).toBe(true);
    expect(w.ack(1, 2)).toBe(false);
    expect(w.ack(1, 1)).toBe(false);
    expect(() => w.ack(1, 9)).toThrow(InvalidSeqError);
    expect(() => w.ack(1, -1)).toThrow(InvalidSeqError);
    expect(w.cumAck()).toBe(2);
    expect(w.inFlight()).toBe(0);
  });

  test("RTO retransmit then fail after maxRetx", () => {
    const { clock, w } = aw({ windowSize: 2, rtoMs: 5, maxRetx: 1 });
    w.send("x");
    clock.advance(5);
    expect(w.drive()).toEqual({ retransmitted: [1], failed: [] });
    clock.advance(5);
    expect(w.drive()).toEqual({ retransmitted: [], failed: [1] });
    expect(w.inFlight()).toBe(0);
    expect(w.payloadOf(1)).toBe("x");
    expect(w.send("y").seq).toBe(2);
  });

  test("ack before RTO prevents retransmit", () => {
    const { clock, w } = aw({ rtoMs: 10, maxRetx: 3 });
    w.send("a");
    clock.advance(9);
    w.ack(1, 1);
    clock.advance(1);
    expect(w.drive()).toEqual({ retransmitted: [], failed: [] });
  });

  test("recv in order delivers; poll clears", () => {
    const { w } = aw();
    expect(w.recv(1, 1, "a")).toBe("delivered");
    expect(w.recv(1, 2, "b")).toBe("delivered");
    expect(w.poll()).toEqual([
      { seq: 1, payload: "a" },
      { seq: 2, payload: "b" },
    ]);
    expect(w.poll()).toEqual([]);
    expect(w.nextDeliver()).toBe(3);
  });

  test("out-of-order buffer then gap fill delivers contiguous", () => {
    const { w } = aw({ recvBufSize: 3 });
    expect(w.recv(1, 3, "c")).toBe("buffered");
    expect(w.recv(1, 2, "b")).toBe("buffered");
    expect(w.buffered()).toBe(2);
    expect(w.poll()).toEqual([]);
    expect(w.recv(1, 1, "a")).toBe("delivered");
    expect(w.poll()).toEqual([
      { seq: 1, payload: "a" },
      { seq: 2, payload: "b" },
      { seq: 3, payload: "c" },
    ]);
    expect(w.buffered()).toBe(0);
  });

  test("duplicate and drop when recv buffer full", () => {
    const { w } = aw({ recvBufSize: 1 });
    expect(w.recv(1, 2, "b")).toBe("buffered");
    expect(w.recv(1, 2, "b2")).toBe("duplicate");
    expect(w.recv(1, 3, "c")).toBe("dropped");
    expect(w.recv(1, 1, "a")).toBe("delivered");
    expect(w.poll()).toEqual([
      { seq: 1, payload: "a" },
      { seq: 2, payload: "b" },
    ]);
    expect(w.recv(1, 1, "a")).toBe("duplicate");
  });

  test("stale epoch on ack/recv; reset bumps epoch and clears state", () => {
    const { w } = aw({ windowSize: 2 });
    w.send("a");
    w.recv(1, 2, "x");
    expect(() => w.ack(2, 1)).toThrow(StaleEpochError);
    expect(() => w.recv(2, 1, "z")).toThrow(StaleEpochError);
    const ep = w.reset();
    expect(ep).toBe(2);
    expect(w.epoch()).toBe(2);
    expect(w.inFlight()).toBe(0);
    expect(w.buffered()).toBe(0);
    expect(w.nextDeliver()).toBe(1);
    expect(w.send("n").seq).toBe(1);
  });

  test("close blocks send/recv; drive still works", () => {
    const { clock, w } = aw({ rtoMs: 4, maxRetx: 0 });
    w.send("a");
    w.close();
    expect(() => w.send("b")).toThrow(ClosedError);
    expect(() => w.recv(1, 1, "x")).toThrow(ClosedError);
    clock.advance(4);
    expect(w.drive().failed).toEqual([1]);
  });

  test("interleaved: window + OOO + RTO + partial ack", () => {
    const { clock, w } = aw({
      windowSize: 3,
      rtoMs: 10,
      maxRetx: 1,
      recvBufSize: 2,
    });
    const s1 = w.send("p1");
    const s2 = w.send("p2");
    const s3 = w.send("p3");
    expect(() => w.send("p4")).toThrow(WindowFullError);
    expect(w.recv(1, 2, "p2")).toBe("buffered");
    expect(w.recv(1, 3, "p3")).toBe("buffered");
    expect(w.recv(1, 4, "p4")).toBe("dropped");
    clock.advance(10);
    const d1 = w.drive();
    expect(d1.retransmitted).toEqual([1, 2, 3]);
    w.ack(1, 1);
    expect(w.inFlight()).toBe(2);
    expect(w.recv(1, 1, "p1")).toBe("delivered");
    expect(w.poll().map((x) => x.seq)).toEqual([1, 2, 3]);
    w.ack(1, 3);
    expect(w.inFlight()).toBe(0);
    expect(s1.seq + s2.seq + s3.seq).toBe(6);
  });

  test("maxRetx zero fails on first RTO", () => {
    const { clock, w } = aw({ maxRetx: 0, rtoMs: 3, windowSize: 1 });
    w.send("z");
    clock.advance(3);
    expect(w.drive()).toEqual({ retransmitted: [], failed: [1] });
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("multiple due seqs fail/retrans in ascending order", () => {
    const { clock, w } = aw({ windowSize: 3, rtoMs: 5, maxRetx: 0 });
    w.send("a");
    w.send("b");
    w.send("c");
    clock.advance(5);
    expect(w.drive().failed).toEqual([1, 2, 3]);
  });

  test("ack after failed seq still validates maxSent", () => {
    const { clock, w } = aw({ windowSize: 2, rtoMs: 2, maxRetx: 0 });
    w.send("a");
    w.send("b");
    clock.advance(2);
    w.drive();
    // both failed, maxSent still 2; cumAck 2 ok and no-op on inflight
    expect(w.ack(1, 2)).toBe(true);
    expect(w.cumAck()).toBe(2);
  });
});
