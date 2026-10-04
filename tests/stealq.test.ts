import {
  VirtualClock,
  StealQ,
  InvalidConfigError,
  InvalidArgError,
  UnknownItemError,
  FenceError,
} from "../src/index.js";

function sq(
  o: Partial<{
    stealAfterMs: number;
    leaseMs: number;
    maxInflight: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new StealQ({
    clock,
    stealAfterMs: o.stealAfterMs ?? 5,
    leaseMs: o.leaseMs ?? 10,
    maxInflight: o.maxInflight ?? 4,
  });
  return { clock, n };
}

describe("stealq hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new StealQ({ clock, stealAfterMs: 0, leaseMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new StealQ({ clock, stealAfterMs: 1, leaseMs: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("lease own queue before steal", () => {
    const { clock, n } = sq({ stealAfterMs: 1 });
    const a = n.enqueue("w1", "a").itemId;
    n.enqueue("w2", "b");
    clock.advance(10);
    const got = n.lease("w1");
    expect(got?.itemId).toBe(a);
    expect(got?.owner).toBe("w1");
  });

  test("first empty lease arms idle and does not steal", () => {
    const { n } = sq({ stealAfterMs: 1 });
    const b = n.enqueue("w2", "b").itemId;
    expect(n.lease("w1")).toBeNull();
    expect(n.queuedIds("w2")).toEqual([b]);
  });

  test("steal oldest after idle wait; nack returns to owner", () => {
    const { clock, n } = sq({ stealAfterMs: 5, leaseMs: 20 });
    const b = n.enqueue("w2", "b").itemId;
    const c = n.enqueue("w2", "c").itemId;
    n.lease("w1");
    clock.advance(5);
    const got = n.lease("w1");
    expect(got?.itemId).toBe(b);
    expect(got?.owner).toBe("w2");
    expect(n.nack("w1", got!.itemId, got!.fence)).toBe(true);
    expect(n.queuedIds("w2")).toEqual([c, b]);
    expect(n.queuedIds("w1")).toEqual([]);
  });

  test("ack done; fence mismatch; wrong worker", () => {
    const { n } = sq();
    const id = n.enqueue("w1", 1).itemId;
    const l = n.lease("w1");
    expect(() => n.ack("w1", id, l!.fence + 1)).toThrow(FenceError);
    expect(n.ack("w2", id, l!.fence)).toBe(false);
    expect(n.ack("w1", id, l!.fence)).toBe(true);
    expect(n.statusOf(id)).toBe("done");
    expect(n.ack("w1", id, l!.fence)).toBe(false);
  });

  test("drive expires to owner not thief", () => {
    const { clock, n } = sq({ stealAfterMs: 1, leaseMs: 3 });
    const id = n.enqueue("w2", "x").itemId;
    n.lease("w1");
    clock.advance(1);
    const l = n.lease("w1");
    expect(l?.itemId).toBe(id);
    clock.advance(3);
    expect(n.statusOf(id)).toBe("leased");
    expect(n.lease("w1")).toBeNull();
    expect(n.drive().expired).toEqual([id]);
    expect(n.queuedIds("w2")).toEqual([id]);
    expect(n.inflightIds("w1")).toEqual([]);
  });

  test("maxInflight blocks local and steal", () => {
    const { clock, n } = sq({ maxInflight: 1, stealAfterMs: 1 });
    n.enqueue("w1", 1);
    n.enqueue("w2", 2);
    expect(n.lease("w1")).not.toBeNull();
    clock.advance(1);
    expect(n.lease("w1")).toBeNull();
  });

  test("steal prefers earlier enqueuedAt then smaller id", () => {
    const { clock, n } = sq({ stealAfterMs: 2 });
    const a = n.enqueue("a", 1).itemId;
    clock.advance(1);
    n.enqueue("b", 1);
    n.lease("thief");
    clock.advance(2);
    expect(n.lease("thief")?.itemId).toBe(a);
  });

  test("enqueue clears idle so steal delayed again", () => {
    const { clock, n } = sq({ stealAfterMs: 3 });
    n.enqueue("other", 1);
    n.lease("w");
    clock.advance(3);
    n.enqueue("w", "mine");
    n.lease("w"); // takes own
    expect(n.lease("w")).toBeNull(); // arms idle again, does not steal other remaining? other still queued unless stolen
  });

  test("unknown item; invalid args; clock negative", () => {
    const { clock, n } = sq();
    expect(() => n.enqueue("", 1)).toThrow(InvalidArgError);
    expect(() => n.lease("")).toThrow(InvalidArgError);
    expect(() => n.statusOf(9)).toThrow(UnknownItemError);
    expect(() => n.ownerOf(9)).toThrow(UnknownItemError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("fifo own queue", () => {
    const { n } = sq();
    const a = n.enqueue("w", "a").itemId;
    const b = n.enqueue("w", "b").itemId;
    expect(n.lease("w")?.itemId).toBe(a);
    expect(n.lease("w")?.itemId).toBe(b);
  });

  test("cannot steal from self by renaming", () => {
    const { clock, n } = sq({ stealAfterMs: 1 });
    n.enqueue("w", 1);
    n.lease("w");
    clock.advance(1);
    expect(n.lease("w")).toBeNull();
  });

  test("drive expired ids sorted", () => {
    const { clock, n } = sq({ leaseMs: 2, stealAfterMs: 100 });
    const a = n.enqueue("w", 1).itemId;
    const b = n.enqueue("w", 2).itemId;
    n.lease("w");
    n.lease("w");
    clock.advance(2);
    expect(n.drive().expired).toEqual([a, b].sort((x, y) => x - y));
  });

  test("inflight ids sorted", () => {
    const { n } = sq();
    n.enqueue("w", 1);
    n.enqueue("w", 2);
    const x = n.lease("w")!.itemId;
    const y = n.lease("w")!.itemId;
    expect(n.inflightIds("w")).toEqual([x, y].sort((a, b) => a - b));
  });

  test("nack wrong worker false", () => {
    const { n } = sq();
    const id = n.enqueue("w1", 1).itemId;
    const l = n.lease("w1")!;
    expect(n.nack("w2", id, l.fence)).toBe(false);
    expect(n.statusOf(id)).toBe("leased");
  });

  test("same-time enqueue steal by itemId", () => {
    const { clock, n } = sq({ stealAfterMs: 1 });
    const a = n.enqueue("a", 1).itemId;
    const b = n.enqueue("b", 1).itemId;
    n.lease("t");
    clock.advance(1);
    expect(n.lease("t")?.itemId).toBe(Math.min(a, b));
  });
});
