import {
  VirtualClock,
  DrainQ,
  InvalidConfigError,
  InvalidEnqueueError,
  InvalidLeaseError,
  UnknownItemError,
  FenceError,
} from "../src/index.js";

function dq(
  o: Partial<{
    leaseMs: number;
    maxInflight: number;
    maxQuarantine: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new DrainQ({
    clock,
    leaseMs: o.leaseMs ?? 10,
    maxInflight: o.maxInflight ?? 2,
    maxQuarantine: o.maxQuarantine ?? 2,
  });
  return { clock, n };
}

describe("drainq hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new DrainQ({ clock, leaseMs: 0 })).toThrow(InvalidConfigError);
  });

  test("enqueue lease ack happy path", () => {
    const { n } = dq();
    const e = n.enqueue("p");
    expect(e.generation).toBe(1);
    const L = n.lease("c1");
    expect(L?.payload).toBe("p");
    expect(n.ack("c1", L!.itemId, L!.fence)).toBe(true);
    expect(n.statusOf(e.itemId)).toBe("done");
  });

  test("lease order by itemId; max inflight null", () => {
    const { n } = dq({ maxInflight: 1 });
    n.enqueue("a");
    n.enqueue("b");
    const L1 = n.lease("c");
    expect(L1?.payload).toBe("a");
    expect(n.lease("c")).toBeNull();
    n.ack("c", L1!.itemId, L1!.fence);
    expect(n.lease("c")?.payload).toBe("b");
  });

  test("nack requeues; quarantine path", () => {
    const { n } = dq();
    n.enqueue("x");
    const L = n.lease("c");
    expect(n.nack("c", L!.itemId, L!.fence)).toBe(true);
    expect(n.statusOf(L!.itemId)).toBe("queued");
    const L2 = n.lease("c");
    expect(n.nack("c", L2!.itemId, L2!.fence, { quarantine: true })).toBe(
      true,
    );
    expect(n.quarantineIds()).toEqual([L2!.itemId]);
    expect(n.requeueQuarantine(L2!.itemId)).toBe(true);
    expect(n.queuedIds()).toEqual([L2!.itemId]);
  });

  test("beginDrain redirects writes; lease still old gen", () => {
    const { n } = dq();
    n.enqueue("old");
    const next = n.beginDrain();
    expect(next).toBe(2);
    expect(n.mode()).toBe("draining");
    expect(n.writeGeneration()).toBe(2);
    const neu = n.enqueue("new");
    expect(neu.generation).toBe(2);
    expect(n.lease("c")?.payload).toBe("old");
    expect(n.queuedIds(2)).toEqual([neu.itemId]);
  });

  test("finishDrain only when old gen idle", () => {
    const { n } = dq();
    n.enqueue("old");
    n.beginDrain();
    n.enqueue("new");
    expect(n.finishDrain()).toBe(false);
    const L = n.lease("c");
    n.ack("c", L!.itemId, L!.fence);
    expect(n.finishDrain()).toBe(true);
    expect(n.activeGeneration()).toBe(2);
    expect(n.mode()).toBe("running");
    expect(n.lease("c")?.payload).toBe("new");
  });

  test("explicit generation must match write gen", () => {
    const { n } = dq();
    expect(() => n.enqueue("x", { generation: 2 })).toThrow(
      InvalidEnqueueError,
    );
    n.beginDrain();
    expect(() => n.enqueue("x", { generation: 1 })).toThrow(
      InvalidEnqueueError,
    );
    expect(n.enqueue("y", { generation: 2 }).generation).toBe(2);
  });

  test("lease timeout requeues via drive", () => {
    const { clock, n } = dq({ leaseMs: 5 });
    n.enqueue("t");
    const L = n.lease("c");
    clock.advance(5);
    expect(n.drive().expired).toEqual([L!.itemId]);
    expect(n.statusOf(L!.itemId)).toBe("queued");
    expect(() => n.ack("c", L!.itemId, L!.fence)).toThrow(FenceError);
  });

  test("fence mismatch; unknown item; empty consumer", () => {
    const { n } = dq();
    n.enqueue(1);
    const L = n.lease("c");
    expect(() => n.ack("c", L!.itemId, L!.fence + 1)).toThrow(FenceError);
    expect(() => n.statusOf(99)).toThrow(UnknownItemError);
    expect(() => n.lease("")).toThrow(InvalidLeaseError);
  });

  test("quarantine full keeps leased", () => {
    const { n } = dq({ maxQuarantine: 1 });
    n.enqueue("a");
    n.enqueue("b");
    const a = n.lease("c");
    n.nack("c", a!.itemId, a!.fence, { quarantine: true });
    const b = n.lease("c");
    expect(() =>
      n.nack("c", b!.itemId, b!.fence, { quarantine: true }),
    ).toThrow(InvalidLeaseError);
    expect(n.statusOf(b!.itemId)).toBe("leased");
  });

  test("double beginDrain throws; finish when not draining false", () => {
    const { n } = dq();
    expect(n.finishDrain()).toBe(false);
    n.beginDrain();
    expect(() => n.beginDrain()).toThrow(InvalidEnqueueError);
  });

  test("requeue stale quarantine after finish throws", () => {
    const { n } = dq();
    n.enqueue("old");
    const L = n.lease("c");
    n.nack("c", L!.itemId, L!.fence, { quarantine: true });
    n.beginDrain();
    n.enqueue("new");
    expect(n.finishDrain()).toBe(true);
    expect(() => n.requeueQuarantine(L!.itemId)).toThrow(InvalidEnqueueError);
  });

  test("wrong consumer ack/nack false", () => {
    const { n } = dq();
    n.enqueue(1);
    const L = n.lease("c1");
    expect(n.ack("c2", L!.itemId, L!.fence)).toBe(false);
    expect(n.nack("c2", L!.itemId, L!.fence)).toBe(false);
  });

  test("clock negative; inflight ids", () => {
    const { clock, n } = dq();
    n.enqueue(1);
    n.enqueue(2);
    const a = n.lease("c");
    const b = n.lease("c");
    expect(n.inflightIds()).toEqual([a!.itemId, b!.itemId]);
    expect(() => clock.advance(-1)).toThrow();
  });
});
