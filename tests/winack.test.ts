import {
  VirtualClock,
  WinAck,
  InvalidConfigError,
  InvalidSeqError,
  WindowFullError,
  UnknownSeqError,
} from "../src/index.js";

function wa(
  o: Partial<{
    windowSize: number;
    rtoMs: number;
    maxRetransmit: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new WinAck({
    clock,
    windowSize: o.windowSize ?? 4,
    rtoMs: o.rtoMs ?? 5,
    maxRetransmit: o.maxRetransmit ?? 2,
  });
  return { clock, n };
}

describe("winack hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new WinAck({ clock, windowSize: 0, rtoMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new WinAck({ clock, windowSize: 1, rtoMs: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("send allocates seq; ack cumulative", () => {
    const { n } = wa();
    expect(n.send("a")).toEqual({ seq: 1 });
    expect(n.send("b")).toEqual({ seq: 2 });
    expect(n.ack(2)).toEqual({ advanced: 2 });
    expect(n.cumAck()).toBe(2);
    expect(n.windowUsed()).toBe(0);
    expect(n.statusOf(1)).toBe("acked");
  });

  test("ack idempotent and rejects beyond nextSeq", () => {
    const { n } = wa();
    n.send("a");
    expect(n.ack(1).advanced).toBe(1);
    expect(n.ack(1).advanced).toBe(0);
    expect(() => n.ack(2)).toThrow(InvalidSeqError);
  });

  test("window full counts awaiting_resend", () => {
    const { n } = wa({ windowSize: 2 });
    n.send(1);
    n.send(2);
    expect(() => n.send(3)).toThrow(WindowFullError);
    n.nack(1);
    expect(n.windowUsed()).toBe(2);
    expect(n.inflightCount()).toBe(1);
    expect(() => n.send(3)).toThrow(WindowFullError);
    n.ack(2);
    expect(n.windowUsed()).toBe(0);
    expect(n.send(3).seq).toBe(3);
  });

  test("nack then resend; duplicate nack false", () => {
    const { n } = wa();
    n.send("a");
    n.send("b");
    expect(n.nack(2)).toBe(true);
    expect(n.nack(2)).toBe(false);
    expect(n.awaitingSeqs()).toEqual([2]);
    expect(n.resend()).toEqual({ seq: 2, payload: "b" });
    expect(n.statusOf(2)).toBe("inflight");
    expect(n.awaitingSeqs()).toEqual([]);
  });

  test("drive times out to awaiting; send does not", () => {
    const { clock, n } = wa({ rtoMs: 3 });
    const s = n.send("x").seq;
    clock.advance(3);
    expect(n.send("y").seq).toBe(2);
    expect(n.statusOf(s)).toBe("inflight");
    expect(n.drive().timedOut).toEqual([s]);
    expect(n.statusOf(s)).toBe("awaiting_resend");
  });

  test("drive drops after maxRetransmit", () => {
    const { clock, n } = wa({ rtoMs: 1, maxRetransmit: 1, windowSize: 2 });
    const s = n.send("x").seq;
    clock.advance(1);
    n.drive();
    n.resend(); // retransmits=1
    clock.advance(1);
    expect(n.drive().dropped).toEqual([s]);
    expect(n.statusOf(s)).toBe("dropped");
    expect(n.windowUsed()).toBe(0);
  });

  test("ack removes from resend queue", () => {
    const { n } = wa();
    n.send("a");
    n.send("b");
    n.nack(1);
    n.nack(2);
    expect(n.ack(1).advanced).toBe(1);
    expect(n.awaitingSeqs()).toEqual([2]);
  });

  test("resend fifo order", () => {
    const { clock, n } = wa({ rtoMs: 1 });
    n.send("a");
    n.send("b");
    clock.advance(1);
    n.drive();
    expect(n.awaitingSeqs()).toEqual([1, 2]);
    expect(n.resend()?.seq).toBe(1);
    expect(n.resend()?.seq).toBe(2);
  });

  test("unknown nack; invalid seq", () => {
    const { n } = wa();
    expect(() => n.nack(1)).toThrow(UnknownSeqError);
    expect(() => n.nack(1.5)).toThrow(InvalidSeqError);
    expect(() => n.ack(-1)).toThrow(InvalidSeqError);
    expect(() => n.statusOf(9)).toThrow(UnknownSeqError);
  });

  test("clock negative", () => {
    const { clock } = wa();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("partial ack leaves later inflight", () => {
    const { n } = wa();
    n.send(1);
    n.send(2);
    n.send(3);
    expect(n.ack(2).advanced).toBe(2);
    expect(n.inflightSeqs()).toEqual([3]);
    expect(n.cumAck()).toBe(2);
  });

  test("maxRetransmit zero drops on first timeout", () => {
    const { clock, n } = wa({ rtoMs: 1, maxRetransmit: 0 });
    const s = n.send("x").seq;
    clock.advance(1);
    expect(n.drive()).toEqual({ timedOut: [], dropped: [s] });
  });

  test("acked nack throws unknown", () => {
    const { n } = wa();
    n.send("a");
    n.ack(1);
    expect(() => n.nack(1)).toThrow(UnknownSeqError);
  });

  test("inflightSeqs sorted", () => {
    const { n } = wa();
    n.send(1);
    n.send(2);
    n.nack(1);
    expect(n.inflightSeqs()).toEqual([2]);
  });

  test("resend null when empty", () => {
    const { n } = wa();
    expect(n.resend()).toBeNull();
  });

  test("window frees after drop allowing send", () => {
    const { clock, n } = wa({
      windowSize: 1,
      rtoMs: 1,
      maxRetransmit: 0,
    });
    n.send("a");
    clock.advance(1);
    n.drive();
    expect(n.send("b").seq).toBe(2);
  });
});
