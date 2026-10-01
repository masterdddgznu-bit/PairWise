import { VirtualClock, BatchQueue } from "../src/index.js";

function queue(maxBatch = 3, maxWaitMs = 100) {
  const clock = new VirtualClock();
  return {
    clock,
    q: new BatchQueue(clock, { maxBatch, maxWaitMs }),
    maxBatch,
    maxWaitMs,
  };
}

describe("batchq multi-tenant batching", () => {
  test("enqueue first item returns null flushed", () => {
    const { q } = queue();
    expect(q.enqueue("t1", "a")).toEqual({ flushed: null });
  });

  test("flush empty tenant returns empty array", () => {
    const { q } = queue();
    expect(q.flush("t1")).toEqual([]);
  });

  test("pending zero on fresh queue", () => {
    const { q } = queue();
    expect(q.pending("t1")).toBe(0);
  });

  test("peek on empty tenant returns empty array", () => {
    const { q } = queue();
    expect(q.peek("t1")).toEqual([]);
  });

  test("poll on empty queue returns empty object", () => {
    const { q } = queue();
    expect(q.poll()).toEqual({});
  });

  test("export empty state and import into fresh queue", () => {
    const { clock, q } = queue();
    const snap = q.exportState();
    const q2 = new BatchQueue(clock, { maxBatch: 3, maxWaitMs: 100 });
    q2.importState(snap);
    expect(q2.pending("t1")).toBe(0);
  });

  test("clearTenant on unknown tenant is safe", () => {
    const { q } = queue();
    expect(() => q.clearTenant("nobody")).not.toThrow();
    expect(q.enqueue("someone", "x")).toEqual({ flushed: null });
  });

  test("manual flush returns enqueued payloads in order", () => {
    const { q } = queue(10, 500);
    q.enqueue("t1", "one");
    q.enqueue("t1", "two");
    expect(q.flush("t1")).toEqual(["one", "two"]);
  });

  test("pending increments below maxBatch", () => {
    const { q } = queue(5, 200);
    q.enqueue("t1", "a");
    q.enqueue("t1", "b");
    expect(q.pending("t1")).toBe(2);
  });

  test("no auto flush when count stays below maxBatch", () => {
    const { q } = queue(4, 300);
    q.enqueue("t1", "a");
    q.enqueue("t1", "b");
    q.enqueue("t1", "c");
    expect(q.pending("t1")).toBe(3);
    expect(q.peek("t1")).toEqual(["a", "b", "c"]);
  });

  test("size flush when count reaches maxBatch exactly", () => {
    const { q } = queue(3, 500);
    q.enqueue("t1", "a");
    q.enqueue("t1", "b");
    const r = q.enqueue("t1", "c");
    expect(r.flushed).toEqual(["a", "b", "c"]);
    expect(q.pending("t1")).toBe(0);
  });

  test("time flush at exactly maxWaitMs via poll", () => {
    const { clock, q, maxWaitMs } = queue(10, 80);
    q.enqueue("t1", "wait-me");
    clock.advance(maxWaitMs);
    expect(q.poll()).toEqual({ t1: ["wait-me"] });
    expect(q.pending("t1")).toBe(0);
  });

  test("enqueue pre-flushes due batch before accepting new item", () => {
    const { clock, q, maxWaitMs } = queue(10, 60);
    q.enqueue("t1", "old");
    clock.advance(maxWaitMs);
    const r = q.enqueue("t1", "new");
    expect(r.flushed).toEqual(["old"]);
    expect(q.peek("t1")).toEqual(["new"]);
  });

  test("tenants isolated — flush one does not drain the other", () => {
    const { q } = queue(10, 500);
    q.enqueue("alpha", "a1");
    q.enqueue("beta", "b1");
    expect(q.flush("alpha")).toEqual(["a1"]);
    expect(q.pending("beta")).toBe(1);
    expect(q.peek("beta")).toEqual(["b1"]);
  });

  test("poll after advance flushes all due tenants", () => {
    const { clock, q, maxWaitMs } = queue(10, 50);
    q.enqueue("t1", "x");
    q.enqueue("t2", "y");
    clock.advance(maxWaitMs);
    const got = q.poll();
    expect(got.t1).toEqual(["x"]);
    expect(got.t2).toEqual(["y"]);
    expect(q.pending("t1")).toBe(0);
    expect(q.pending("t2")).toBe(0);
  });

  test("poll flushes two tenants when both batches are due", () => {
    const { clock, q, maxWaitMs } = queue(8, 40);
    q.enqueue("east", "e1");
    q.enqueue("west", "w1");
    clock.advance(maxWaitMs + 5);
    const got = q.poll();
    expect(Object.keys(got).sort()).toEqual(["east", "west"]);
    expect(got.east).toEqual(["e1"]);
    expect(got.west).toEqual(["w1"]);
  });

  test("import preserves enqueuedAt for subsequent poll timing", () => {
    const { clock, q, maxWaitMs } = queue(10, 70);
    clock.advance(10);
    q.enqueue("t1", "snap");
    const snap = q.exportState();
    const q2 = new BatchQueue(clock, { maxBatch: 10, maxWaitMs });
    q2.importState(snap);
    clock.advance(maxWaitMs);
    expect(q2.poll()).toEqual({ t1: ["snap"] });
  });

  test("clearTenant removes all pending for that tenant", () => {
    const { q } = queue();
    q.enqueue("t1", "a");
    q.enqueue("t1", "b");
    q.clearTenant("t1");
    expect(q.pending("t1")).toBe(0);
    expect(q.peek("t1")).toEqual([]);
  });

  test("peek returns copy that does not mutate internal pending", () => {
    const { q } = queue(10, 200);
    q.enqueue("t1", "keep");
    const view = q.peek("t1");
    view.push("ghost");
    expect(q.peek("t1")).toEqual(["keep"]);
    expect(q.pending("t1")).toBe(1);
  });

  test("flush clears pending fully", () => {
    const { q } = queue(10, 300);
    q.enqueue("t1", "only");
    q.flush("t1");
    expect(q.pending("t1")).toBe(0);
    expect(q.flush("t1")).toEqual([]);
  });

  test("enqueue returns flushed payloads on size boundary", () => {
    const { q } = queue(2, 400);
    q.enqueue("t1", "p1");
    const r = q.enqueue("t1", "p2");
    expect(r.flushed).toEqual(["p1", "p2"]);
  });

  test("poll does not merge payloads across tenants", () => {
    const { clock, q, maxWaitMs } = queue(10, 55);
    q.enqueue("t1", "only-t1");
    q.enqueue("t2", "only-t2");
    clock.advance(maxWaitMs);
    const got = q.poll();
    expect(got.t1).toEqual(["only-t1"]);
    expect(got.t2).toEqual(["only-t2"]);
    expect(got.t1).not.toContain("only-t2");
  });
});
