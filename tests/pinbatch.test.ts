import {
  VirtualClock,
  PinBatch,
  InvalidConfigError,
  InvalidBatchError,
  FenceError,
  UnknownBatchError,
  InvalidPinError,
} from "../src/index.js";

function pb(
  o: Partial<{
    leaseMs: number;
    maxKeysPerBatch: number;
    maxWaitersPerKey: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new PinBatch({
    clock,
    leaseMs: o.leaseMs ?? 10,
    maxKeysPerBatch: o.maxKeysPerBatch ?? 3,
    maxWaitersPerKey: o.maxWaitersPerKey ?? 2,
  });
  return { clock, n };
}

describe("pinbatch hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new PinBatch({ clock, leaseMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("open pin seal commit releases keys", () => {
    const { n } = pb();
    const o = n.open("h");
    expect(n.pin("h", o.batchId, o.fence, "a")).toEqual({ status: "pinned" });
    expect(n.pin("h", o.batchId, o.fence, "b")).toEqual({ status: "pinned" });
    expect(n.keysOf(o.batchId)).toEqual(["a", "b"]);
    expect(n.seal("h", o.batchId, o.fence)).toBe(true);
    expect(n.commit("h", o.batchId, o.fence)).toBe(true);
    expect(n.holderOfKey("a")).toBeUndefined();
    expect(n.statusOf(o.batchId)).toBe("committed");
  });

  test("conflict waits; commit promotes waiter", () => {
    const { n } = pb();
    const a = n.open("a");
    n.pin("a", a.batchId, a.fence, "k");
    n.seal("a", a.batchId, a.fence);
    const b = n.open("b");
    const w = n.pin("b", b.batchId, b.fence, "k");
    expect(w.status).toBe("waiting");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.waitingTickets("k")).toEqual([w.ticket]);
    n.commit("a", a.batchId, a.fence);
    expect(n.holderOfKey("k")).toBe("b");
    expect(n.keysOf(b.batchId)).toEqual(["k"]);
    expect(n.waitingTickets("k")).toEqual([]);
  });

  test("cannot seal while own wait pending", () => {
    const { n } = pb();
    const a = n.open("a");
    n.pin("a", a.batchId, a.fence, "k");
    n.seal("a", a.batchId, a.fence);
    const b = n.open("b");
    n.pin("b", b.batchId, b.fence, "k");
    expect(() => n.seal("b", b.batchId, b.fence)).toThrow(InvalidBatchError);
  });

  test("cancelWait then seal ok", () => {
    const { n } = pb();
    const a = n.open("a");
    n.pin("a", a.batchId, a.fence, "k");
    n.seal("a", a.batchId, a.fence);
    const b = n.open("b");
    const w = n.pin("b", b.batchId, b.fence, "k");
    if (w.status !== "waiting") throw new Error("x");
    expect(n.cancelWait("b", w.ticket)).toBe(true);
    expect(n.seal("b", b.batchId, b.fence)).toBe(true);
  });

  test("timeout aborts and promotes", () => {
    const { clock, n } = pb({ leaseMs: 4 });
    const a = n.open("a");
    n.pin("a", a.batchId, a.fence, "k");
    clock.advance(1);
    const b = n.open("b");
    const w = n.pin("b", b.batchId, b.fence, "k");
    expect(w.status).toBe("waiting");
    clock.advance(3);
    expect(n.drive().timedOut).toEqual([a.batchId]);
    expect(n.statusOf(a.batchId)).toBe("timedout");
    expect(n.statusOf(b.batchId)).toBe("open");
    expect(n.holderOfKey("k")).toBe("b");
  });

  test("holder cannot open second active batch", () => {
    const { n } = pb();
    n.open("h");
    expect(() => n.open("h")).toThrow(InvalidBatchError);
  });

  test("max keys; dup pin; bad fence", () => {
    const { n } = pb({ maxKeysPerBatch: 1 });
    const o = n.open("h");
    n.pin("h", o.batchId, o.fence, "a");
    expect(() => n.pin("h", o.batchId, o.fence, "b")).toThrow(InvalidPinError);
    expect(() => n.pin("h", o.batchId, o.fence, "a")).toThrow(InvalidPinError);
    expect(() => n.pin("h", o.batchId, o.fence + 1, "c")).toThrow(FenceError);
  });

  test("abort open releases keys for others", () => {
    const { n } = pb();
    const a = n.open("a");
    n.pin("a", a.batchId, a.fence, "k");
    const b = n.open("b");
    const w = n.pin("b", b.batchId, b.fence, "k");
    expect(w.status).toBe("waiting");
    expect(n.abort("a", a.batchId, a.fence)).toBe(true);
    expect(n.holderOfKey("k")).toBe("b");
    expect(n.statusOf(a.batchId)).toBe("aborted");
  });

  test("pin on sealed batch rejected", () => {
    const { n } = pb();
    const a = n.open("a");
    n.seal("a", a.batchId, a.fence);
    expect(() => n.pin("a", a.batchId, a.fence, "k")).toThrow(InvalidPinError);
  });

  test("queue full; unknown batch; clock negative", () => {
    const { clock, n } = pb({ maxWaitersPerKey: 1 });
    const a = n.open("a");
    n.pin("a", a.batchId, a.fence, "k");
    n.seal("a", a.batchId, a.fence);
    const b = n.open("b");
    n.pin("b", b.batchId, b.fence, "k");
    const c = n.open("c");
    expect(() => n.pin("c", c.batchId, c.fence, "k")).toThrow(InvalidPinError);
    expect(() => n.statusOf(99)).toThrow(UnknownBatchError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("commit requires sealed; abort sealed ok", () => {
    const { n } = pb();
    const o = n.open("h");
    n.pin("h", o.batchId, o.fence, "a");
    expect(n.commit("h", o.batchId, o.fence)).toBe(false);
    n.seal("h", o.batchId, o.fence);
    expect(n.abort("h", o.batchId, o.fence)).toBe(true);
    expect(n.holderOfKey("a")).toBeUndefined();
    expect(n.statusOf(o.batchId)).toBe("aborted");
  });

  test("promote skips dead waiter and grants next open batch", () => {
    const { n } = pb({ maxKeysPerBatch: 1 });
    const a = n.open("a");
    n.pin("a", a.batchId, a.fence, "k");
    n.seal("a", a.batchId, a.fence);
    const b = n.open("b");
    const wb = n.pin("b", b.batchId, b.fence, "k");
    if (wb.status !== "waiting") throw new Error("x");
    n.abort("b", b.batchId, b.fence);
    const c = n.open("c");
    const wc = n.pin("c", c.batchId, c.fence, "k");
    if (wc.status !== "waiting") throw new Error("x");
    n.commit("a", a.batchId, a.fence);
    expect(n.holderOfKey("k")).toBe("c");
  });

  test("empty holder; empty key", () => {
    const { n } = pb();
    expect(() => n.open("")).toThrow(InvalidBatchError);
    const o = n.open("h");
    expect(() => n.pin("h", o.batchId, o.fence, "")).toThrow(InvalidPinError);
  });

  test("heartbeat-like: seal refreshes deadline before timeout", () => {
    const { clock, n } = pb({ leaseMs: 5 });
    const o = n.open("h");
    n.pin("h", o.batchId, o.fence, "a");
    clock.advance(4);
    n.seal("h", o.batchId, o.fence);
    clock.advance(4);
    expect(n.drive().timedOut).toEqual([]);
    expect(n.statusOf(o.batchId)).toBe("sealed");
    clock.advance(1);
    expect(n.drive().timedOut).toEqual([o.batchId]);
  });
});
