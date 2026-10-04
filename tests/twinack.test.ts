import {
  VirtualClock,
  TwinAck,
  InvalidConfigError,
  InvalidWriteError,
  FenceError,
  UnknownWriteError,
} from "../src/index.js";

function ta(
  o: Partial<{ ackTimeoutMs: number; maxInflightPerKey: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new TwinAck({
    clock,
    ackTimeoutMs: o.ackTimeoutMs ?? 10,
    maxInflightPerKey: o.maxInflightPerKey ?? 1,
  });
  return { clock, n };
}

describe("twinack hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new TwinAck({ clock, ackTimeoutMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("both acks make value visible; partial not visible", () => {
    const { n } = ta();
    const w = n.write("k", 1);
    expect(n.get("k")).toBeUndefined();
    expect(n.ack(w.writeId, "A", w.fence)).toBe(true);
    expect(n.get("k")).toBeUndefined();
    expect(n.ackedSides(w.writeId)).toEqual(["A"]);
    expect(n.ack(w.writeId, "B", w.fence)).toBe(true);
    expect(n.get("k")).toEqual({ value: 1, fence: 1 });
    expect(n.statusOf(w.writeId)).toBe("visible");
    expect(n.inflightOf("k")).toEqual([]);
  });

  test("duplicate side ack is false; wrong fence throws", () => {
    const { n } = ta();
    const w = n.write("k", "x");
    expect(n.ack(w.writeId, "A", w.fence)).toBe(true);
    expect(n.ack(w.writeId, "A", w.fence)).toBe(false);
    expect(() => n.ack(w.writeId, "B", w.fence + 1)).toThrow(FenceError);
  });

  test("timeout voids partial ack; late ack false", () => {
    const { clock, n } = ta({ ackTimeoutMs: 5 });
    const w = n.write("k", 7);
    n.ack(w.writeId, "A", w.fence);
    clock.advance(5);
    expect(n.drive().timedOut).toEqual([w.writeId]);
    expect(n.statusOf(w.writeId)).toBe("timedout");
    expect(n.ack(w.writeId, "B", w.fence)).toBe(false);
    expect(n.get("k")).toBeUndefined();
  });

  test("cancel voids; cannot ack after cancel", () => {
    const { n } = ta();
    const w = n.write("k", 1);
    expect(n.cancel(w.writeId)).toBe(true);
    expect(n.statusOf(w.writeId)).toBe("cancelled");
    expect(n.ack(w.writeId, "A", w.fence)).toBe(false);
    expect(n.cancel(w.writeId)).toBe(false);
  });

  test("maxInflightPerKey; empty key", () => {
    const { n } = ta({ maxInflightPerKey: 1 });
    n.write("k", 1);
    expect(() => n.write("k", 2)).toThrow(InvalidWriteError);
    expect(() => n.write("", 1)).toThrow(InvalidWriteError);
    expect(n.write("other", 3).fence).toBe(1);
  });

  test("higher fence visible wins when maxInflight > 1", () => {
    const { n } = ta({ maxInflightPerKey: 2 });
    const w1 = n.write("k", "old");
    const w2 = n.write("k", "new");
    expect(w2.fence).toBe(2);
    expect(n.inflightOf("k")).toEqual([w1.writeId, w2.writeId]);
    n.ack(w1.writeId, "A", w1.fence);
    n.ack(w1.writeId, "B", w1.fence);
    expect(n.get("k")).toEqual({ value: "old", fence: 1 });
    n.ack(w2.writeId, "B", w2.fence);
    n.ack(w2.writeId, "A", w2.fence);
    expect(n.get("k")).toEqual({ value: "new", fence: 2 });
  });

  test("older write completing after newer visible does not downgrade", () => {
    const { n } = ta({ maxInflightPerKey: 2 });
    const w1 = n.write("k", 1);
    const w2 = n.write("k", 2);
    n.ack(w2.writeId, "A", w2.fence);
    n.ack(w2.writeId, "B", w2.fence);
    expect(n.get("k")).toEqual({ value: 2, fence: 2 });
    n.ack(w1.writeId, "A", w1.fence);
    n.ack(w1.writeId, "B", w1.fence);
    expect(n.get("k")).toEqual({ value: 2, fence: 2 });
    expect(n.statusOf(w1.writeId)).toBe("visible");
  });

  test("stale ack after superseding timeout still fence-checked", () => {
    const { clock, n } = ta({ ackTimeoutMs: 4, maxInflightPerKey: 1 });
    const w1 = n.write("k", 1);
    clock.advance(4);
    n.drive();
    const w2 = n.write("k", 2);
    expect(w2.fence).toBe(2);
    expect(() => n.ack(w1.writeId, "A", w1.fence)).not.toThrow(FenceError);
    expect(n.ack(w1.writeId, "A", w1.fence)).toBe(false);
    n.ack(w2.writeId, "A", w2.fence);
    n.ack(w2.writeId, "B", w2.fence);
    expect(n.get("k")).toEqual({ value: 2, fence: 2 });
  });

  test("drive reports multiple timeouts sorted", () => {
    const { clock, n } = ta({ ackTimeoutMs: 3, maxInflightPerKey: 2 });
    const a = n.write("x", 1);
    const b = n.write("y", 1);
    clock.advance(3);
    expect(n.drive().timedOut).toEqual([a.writeId, b.writeId]);
    expect(n.drive().timedOut).toEqual([]);
  });

  test("unknown write; invalid side; clock negative", () => {
    const { clock, n } = ta();
    const w = n.write("k", 1);
    expect(() => n.ack(99, "A", 1)).toThrow(UnknownWriteError);
    expect(() => n.statusOf(99)).toThrow(UnknownWriteError);
    expect(() => n.ack(w.writeId, "C" as "A", w.fence)).toThrow(
      InvalidWriteError,
    );
    expect(() => clock.advance(-1)).toThrow();
  });

  test("ack order B then A; ackedSides sorted A then B", () => {
    const { n } = ta();
    const w = n.write("k", 9);
    expect(n.ack(w.writeId, "B", w.fence)).toBe(true);
    expect(n.ackedSides(w.writeId)).toEqual(["B"]);
    expect(n.ack(w.writeId, "A", w.fence)).toBe(true);
    expect(n.ackedSides(w.writeId)).toEqual(["A", "B"]);
  });

  test("visible write ack again false; cancel visible false", () => {
    const { n } = ta();
    const w = n.write("k", 1);
    n.ack(w.writeId, "A", w.fence);
    n.ack(w.writeId, "B", w.fence);
    expect(n.ack(w.writeId, "A", w.fence)).toBe(false);
    expect(n.cancel(w.writeId)).toBe(false);
  });

  test("heartbeat-like: timeout does not clear other key visible", () => {
    const { clock, n } = ta({ ackTimeoutMs: 2 });
    const ok = n.write("keep", "v");
    n.ack(ok.writeId, "A", ok.fence);
    n.ack(ok.writeId, "B", ok.fence);
    const bad = n.write("drop", "x");
    n.ack(bad.writeId, "A", bad.fence);
    clock.advance(2);
    n.drive();
    expect(n.get("keep")).toEqual({ value: "v", fence: 1 });
    expect(n.get("drop")).toBeUndefined();
    expect(n.statusOf(bad.writeId)).toBe("timedout");
  });
});
