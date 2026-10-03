import {
  VirtualClock,
  CutMesh,
  InvalidConfigError,
  UnknownShardError,
  UnknownKeyError,
  NotOwnerError,
  InvalidMoveError,
  FenceError,
  InFlightError,
  UnknownTicketError,
} from "../src/index.js";

function make(
  overrides: Partial<{
    shards: string[];
    dualWriteMs: number;
    drainTimeoutMs: number;
    leaseMs: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const m = new CutMesh({
    clock,
    shards: overrides.shards ?? ["s1", "s2", "s3"],
    dualWriteMs: overrides.dualWriteMs ?? 50,
    drainTimeoutMs: overrides.drainTimeoutMs ?? 30,
    leaseMs: overrides.leaseMs ?? 10,
  });
  return { clock, m };
}

describe("cutmesh hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new CutMesh({
          clock,
          shards: [],
          dualWriteMs: 1,
          drainTimeoutMs: 1,
          leaseMs: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new CutMesh({
          clock,
          shards: ["a", "a"],
          dualWriteMs: 1,
          drainTimeoutMs: 1,
          leaseMs: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new CutMesh({
          clock,
          shards: ["a"],
          dualWriteMs: 0,
          drainTimeoutMs: 1,
          leaseMs: 1,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("place/get/owner/gen; unknown shard/key", () => {
    const { m } = make();
    expect(() => m.place("k", "v", "nope")).toThrow(UnknownShardError);
    m.place("k", "v0", "s1");
    expect(() => m.place("k", "x", "s2")).toThrow(InvalidMoveError);
    expect(m.get("k")).toBe("v0");
    expect(m.ownerOf("k")).toBe("s1");
    expect(m.genOf("k")).toBe(1);
    expect(() => m.get("missing")).toThrow(UnknownKeyError);
  });

  test("beginWrite only owner; fence gen; single inflight", () => {
    const { m } = make();
    m.place("k", "v", "s1");
    expect(() => m.beginWrite("k", "s2", 1)).toThrow(NotOwnerError);
    expect(() => m.beginWrite("k", "s1", 2)).toThrow(FenceError);
    const w = m.beginWrite("k", "s1", 1);
    expect(() => m.beginWrite("k", "s1", 1)).toThrow(InFlightError);
    expect(m.endWrite(w.ticket, w.fence, "v2")).toBe(true);
    expect(m.get("k")).toBe("v2");
  });

  test("cancelWrite and unknown ticket / bad fence", () => {
    const { m } = make();
    m.place("k", "v", "s1");
    const w = m.beginWrite("k", "s1", 1);
    expect(() => m.endWrite(w.ticket, w.fence + 1, "x")).toThrow(FenceError);
    expect(m.cancelWrite(w.ticket, w.fence)).toBe(true);
    expect(m.get("k")).toBe("v");
    expect(() => m.cancelWrite(999, 1)).toThrow(UnknownTicketError);
  });

  test("lease expiry cancels inflight via drive", () => {
    const { clock, m } = make({ leaseMs: 5 });
    m.place("k", "v", "s1");
    const w = m.beginWrite("k", "s1", 1);
    clock.advance(5);
    const rep = m.drive();
    expect(rep.expiredWrites).toEqual([w.ticket]);
    expect(m.inflightTicket("k")).toBeUndefined();
    expect(m.get("k")).toBe("v");
  });

  test("beginMove dual: both shards may write; read stays on source", () => {
    const { m } = make();
    m.place("k", "v0", "s1");
    const mid = m.beginMove("k", "s2");
    expect(m.moveStatus(mid)).toBe("dual");
    expect(m.shadowOf("k")).toBe("v0");
    const wt = m.beginWrite("k", "s2", 1);
    m.endWrite(wt.ticket, wt.fence, "from-target");
    expect(m.get("k")).toBe("v0");
    expect(m.shadowOf("k")).toBe("from-target");
    const ws = m.beginWrite("k", "s1", 1);
    m.endWrite(ws.ticket, ws.fence, "from-source");
    expect(m.get("k")).toBe("from-source");
    expect(m.shadowOf("k")).toBe("from-source");
  });

  test("cannot beginMove with inflight or second move", () => {
    const { m } = make();
    m.place("k", "v", "s1");
    const w = m.beginWrite("k", "s1", 1);
    expect(() => m.beginMove("k", "s2")).toThrow(InFlightError);
    m.cancelWrite(w.ticket, w.fence);
    m.beginMove("k", "s2");
    expect(() => m.beginMove("k", "s3")).toThrow(InvalidMoveError);
    expect(() => m.beginMove("k", "s1")).toThrow(InvalidMoveError);
  });

  test("happy cutover path: catchup → requestCut → auto cut", () => {
    const { m } = make();
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    expect(m.requestCut(mid)).toBe(false);
    expect(m.ackCatchup(mid, "s2")).toBe(true);
    expect(m.requestCut(mid)).toBe(true);
    expect(m.moveStatus(mid)).toBe("cut");
    expect(m.ownerOf("k")).toBe("s2");
    expect(m.genOf("k")).toBe(2);
    expect(m.get("k")).toBe("v");
    expect(m.activeMove("k")).toBeUndefined();
    expect(() => m.beginWrite("k", "s1", 2)).toThrow(NotOwnerError);
    const w = m.beginWrite("k", "s2", 2);
    m.endWrite(w.ticket, w.fence, "ok");
    expect(m.get("k")).toBe("ok");
  });

  test("requestCut blocked by inflight; cutover after endWrite", () => {
    const { m } = make({ drainTimeoutMs: 100 });
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    m.ackCatchup(mid, "s2");
    const w = m.beginWrite("k", "s1", 1);
    expect(() => m.requestCut(mid)).toThrow(InFlightError);
    m.endWrite(w.ticket, w.fence, "v2");
    expect(m.requestCut(mid)).toBe(true);
    expect(m.moveStatus(mid)).toBe("cut");
    expect(m.get("k")).toBe("v2");
  });

  test("draining rejects new beginWrite; endWrite auto-cuts", () => {
    const { clock, m } = make({
      dualWriteMs: 10,
      drainTimeoutMs: 100,
      leaseMs: 50,
    });
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    m.ackCatchup(mid, "s2");
    const w = m.beginWrite("k", "s1", 1);
    clock.advance(10);
    m.drive();
    expect(m.moveStatus(mid)).toBe("draining");
    expect(() => m.beginWrite("k", "s2", 1)).toThrow(InvalidMoveError);
    m.endWrite(w.ticket, w.fence, "done");
    expect(m.moveStatus(mid)).toBe("cut");
    expect(m.get("k")).toBe("done");
    expect(m.ownerOf("k")).toBe("s2");
  });

  test("dual deadline: caughtUp+idle → drain/autoCut; else forcedAbort", () => {
    const { clock, m } = make({ dualWriteMs: 20, drainTimeoutMs: 5 });
    m.place("a", "1", "s1");
    m.place("b", "2", "s1");
    const ma = m.beginMove("a", "s2");
    const mb = m.beginMove("b", "s2");
    m.ackCatchup(ma, "s2");
    clock.advance(20);
    const rep = m.drive();
    expect(rep.autoCut).toContain(ma);
    expect(rep.forcedAbort).toContain(mb);
    expect(m.moveStatus(ma)).toBe("cut");
    expect(m.moveStatus(mb)).toBe("aborted");
    expect(m.ownerOf("a")).toBe("s2");
    expect(m.ownerOf("b")).toBe("s1");
  });

  test("draining timeout with stuck inflight forcedAbort", () => {
    const { clock, m } = make({
      dualWriteMs: 20,
      drainTimeoutMs: 10,
      leaseMs: 1000,
    });
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    m.ackCatchup(mid, "s2");
    // dual deadline + caughtUp + still-live inflight → draining (not abort)
    const w = m.beginWrite("k", "s1", 1);
    clock.advance(20);
    const rep1 = m.drive();
    expect(rep1.forcedAbort).not.toContain(mid);
    expect(rep1.expiredWrites).toEqual([]);
    expect(m.moveStatus(mid)).toBe("draining");
    expect(() => m.beginWrite("k", "s2", 1)).toThrow(InvalidMoveError);
    clock.advance(10);
    const rep2 = m.drive();
    expect(rep2.forcedAbort).toContain(mid);
    expect(m.moveStatus(mid)).toBe("aborted");
    expect(m.ownerOf("k")).toBe("s1");
    expect(m.inflightTicket("k")).toBe(w.ticket);
  });

  test("abort discards shadow; source value preserved", () => {
    const { m } = make();
    m.place("k", "src", "s1");
    const mid = m.beginMove("k", "s2");
    const w = m.beginWrite("k", "s2", 1);
    m.endWrite(w.ticket, w.fence, "tgt");
    expect(m.shadowOf("k")).toBe("tgt");
    expect(m.requestAbort(mid)).toBe(true);
    expect(m.moveStatus(mid)).toBe("aborted");
    expect(m.get("k")).toBe("src");
    expect(m.shadowOf("k")).toBeUndefined();
    expect(m.genOf("k")).toBe(1);
  });

  test("stale gen after cut rejected", () => {
    const { m } = make();
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    m.ackCatchup(mid, "s2");
    m.requestCut(mid);
    expect(m.genOf("k")).toBe(2);
    expect(() => m.beginWrite("k", "s2", 1)).toThrow(FenceError);
  });

  test("target-only dual writes do not change get until cut", () => {
    const { m } = make();
    m.place("k", "A", "s1");
    const mid = m.beginMove("k", "s3");
    for (const val of ["B", "C", "D"]) {
      const w = m.beginWrite("k", "s3", 1);
      m.endWrite(w.ticket, w.fence, val);
      expect(m.get("k")).toBe("A");
      expect(m.shadowOf("k")).toBe(val);
    }
    m.ackCatchup(mid, "s3");
    m.requestCut(mid);
    expect(m.get("k")).toBe("D");
    expect(m.ownerOf("k")).toBe("s3");
  });

  test("multi-key interleaved moves and leases", () => {
    const { clock, m } = make({
      dualWriteMs: 40,
      drainTimeoutMs: 15,
      leaseMs: 8,
    });
    m.place("k1", "a", "s1");
    m.place("k2", "b", "s2");
    m.place("k3", "c", "s1");
    const m1 = m.beginMove("k1", "s2");
    const m2 = m.beginMove("k2", "s3");
    m.ackCatchup(m1, "s2");
    const w2 = m.beginWrite("k2", "s2", 1);
    clock.advance(8);
    const rep = m.drive();
    expect(rep.expiredWrites).toEqual([w2.ticket]);
    // m2 still dual, not caught up
    clock.advance(32); // total 40 from start
    const rep2 = m.drive();
    expect(rep2.autoCut).toContain(m1);
    expect(rep2.forcedAbort).toContain(m2);
    expect(m.ownerOf("k1")).toBe("s2");
    expect(m.ownerOf("k2")).toBe("s2");
    // k3 untouched
    const w3 = m.beginWrite("k3", "s1", 1);
    m.endWrite(w3.ticket, w3.fence, "c2");
    expect(m.get("k3")).toBe("c2");
  });

  test("ackCatchup wrong shard false; unknown move errors", () => {
    const { m } = make();
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    expect(m.ackCatchup(mid, "s1")).toBe(false);
    expect(() => m.ackCatchup(999, "s2")).toThrow(InvalidMoveError);
    expect(() => m.moveStatus(999)).toThrow(InvalidMoveError);
  });

  test("cutover explicit while draining with cleared inflight", () => {
    const { clock, m } = make({
      dualWriteMs: 10,
      drainTimeoutMs: 100,
      leaseMs: 50,
    });
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    m.ackCatchup(mid, "s2");
    const w = m.beginWrite("k", "s1", 1);
    clock.advance(10);
    m.drive(); // dual deadline → draining (caughtUp, has inflight)
    expect(m.moveStatus(mid)).toBe("draining");
    expect(() => m.cutover(mid)).toThrow(InFlightError);
    m.endWrite(w.ticket, w.fence, "final");
    // endWrite should auto-cut
    expect(m.moveStatus(mid)).toBe("cut");
    expect(m.get("k")).toBe("final");
  });

  test("clock negative advance throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("same-ticket fence reuse after cut is new gen world", () => {
    const { m } = make();
    m.place("k", "v", "s1");
    const mid = m.beginMove("k", "s2");
    m.ackCatchup(mid, "s2");
    m.requestCut(mid);
    expect(m.genOf("k")).toBe(2);
    const w = m.beginWrite("k", "s2", 2);
    m.endWrite(w.ticket, w.fence, "n");
    expect(m.get("k")).toBe("n");
  });
});
