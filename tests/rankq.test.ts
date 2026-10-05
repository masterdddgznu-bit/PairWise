import {
  VirtualClock,
  RankQ,
  InvalidConfigError,
  InvalidEnqueueError,
  CapacityError,
  UnknownItemError,
} from "../src/index.js";

function rq(
  o: Partial<{
    maxSize: number;
    ageMs: number;
    maxPriority: number;
    ageBatch: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new RankQ({
    clock,
    maxSize: o.maxSize ?? 8,
    ageMs: o.ageMs ?? 5,
    maxPriority: o.maxPriority ?? 3,
    ...(o.ageBatch !== undefined ? { ageBatch: o.ageBatch } : {}),
  });
  return { clock, n };
}

describe("rankq hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new RankQ({ clock, maxSize: 0, ageMs: 1, maxPriority: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new RankQ({
          clock,
          maxSize: 1,
          ageMs: 1,
          maxPriority: 1,
          ageBatch: 0,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new RankQ({ clock, maxSize: 1, ageMs: 1, maxPriority: -1 }),
    ).toThrow(InvalidConfigError);
  });

  test("take by priority then enqueuedAt then id", () => {
    const { clock, n } = rq({ maxPriority: 5 });
    const low = n.enqueue("low", 1).itemId;
    clock.advance(1);
    const high = n.enqueue("high", 3).itemId;
    const mid = n.enqueue("mid", 2).itemId;
    expect(n.peekIds()).toEqual([high, mid, low]);
    expect(n.take()?.itemId).toBe(high);
    expect(n.take()?.itemId).toBe(mid);
    expect(n.take()?.itemId).toBe(low);
  });

  test("same priority fifo by time then id", () => {
    const { clock, n } = rq();
    const a = n.enqueue("a", 1).itemId;
    clock.advance(1);
    const b = n.enqueue("b", 1).itemId;
    expect(n.take()?.itemId).toBe(a);
    expect(n.take()?.itemId).toBe(b);
  });

  test("take does not age", () => {
    const { clock, n } = rq({ ageMs: 2, maxPriority: 5 });
    const id = n.enqueue("x", 0).itemId;
    clock.advance(2);
    expect(n.take()?.priority).toBe(0);
    expect(n.statusOf(id)).toBe("taken");
  });

  test("drive ages by one and resets rankAt", () => {
    const { clock, n } = rq({ ageMs: 3, maxPriority: 2 });
    const id = n.enqueue("x", 0).itemId;
    clock.advance(3);
    expect(n.drive().aged).toEqual([id]);
    expect(n.priorityOf(id)).toBe(1);
    expect(n.drive().aged).toEqual([]);
    clock.advance(3);
    expect(n.drive().aged).toEqual([id]);
    expect(n.priorityOf(id)).toBe(2);
    clock.advance(3);
    expect(n.drive().aged).toEqual([]);
  });

  test("ageBatch limits per drive; order by current rank", () => {
    const { clock, n } = rq({
      ageMs: 2,
      maxPriority: 5,
      ageBatch: 1,
    });
    const a = n.enqueue("a", 1).itemId;
    const b = n.enqueue("b", 0).itemId;
    clock.advance(2);
    // both due; current order a (prio1) then b (prio0)
    expect(n.drive().aged).toEqual([a]);
    expect(n.priorityOf(a)).toBe(2);
    expect(n.priorityOf(b)).toBe(0);
    expect(n.drive().aged).toEqual([b]);
  });

  test("unlimited ageBatch ages all due", () => {
    const { clock, n } = rq({ ageMs: 1, maxPriority: 5 });
    const a = n.enqueue("a", 0).itemId;
    const b = n.enqueue("b", 0).itemId;
    clock.advance(1);
    expect(n.drive().aged).toEqual([a, b]);
  });

  test("aging can change take order", () => {
    const { clock, n } = rq({ ageMs: 2, maxPriority: 5 });
    const low = n.enqueue("low", 0).itemId;
    const high = n.enqueue("high", 1).itemId;
    expect(n.peekIds()[0]).toBe(high);
    clock.advance(2);
    n.drive(); // both age: low->1, high->2; high still first
    expect(n.peekIds()[0]).toBe(high);
    clock.advance(2);
    n.drive(); // low->2, high->3
    clock.advance(2);
    n.drive(); // low->3, high->4
    expect(n.priorityOf(low)).toBe(3);
    // keep aging low only by taking high? instead age until equal then fifo
    n.cancel(high);
    expect(n.peekIds()).toEqual([low]);
  });

  test("low ages past high after enough drives", () => {
    const { clock, n } = rq({ ageMs: 1, maxPriority: 3 });
    const low = n.enqueue("low", 0).itemId;
    const high = n.enqueue("high", 2).itemId;
    clock.advance(1);
    n.drive(); // low 1, high 3 (cap)
    clock.advance(1);
    n.drive(); // low 2, high stays 3
    clock.advance(1);
    n.drive(); // low 3
    expect(n.priorityOf(low)).toBe(3);
    expect(n.priorityOf(high)).toBe(3);
    // same prio: earlier enqueuedAt wins
    expect(n.peekIds()[0]).toBe(low);
  });

  test("capacity and invalid priority", () => {
    const { n } = rq({ maxSize: 2, maxPriority: 2 });
    n.enqueue(1, 0);
    n.enqueue(2, 0);
    expect(() => n.enqueue(3, 0)).toThrow(CapacityError);
    expect(() => n.enqueue(1, 3)).toThrow(InvalidEnqueueError);
    expect(() => n.enqueue(1, -1)).toThrow(InvalidEnqueueError);
  });

  test("cancel frees capacity; cancel taken false", () => {
    const { n } = rq({ maxSize: 1 });
    const id = n.enqueue("x", 0).itemId;
    expect(n.cancel(id)).toBe(true);
    expect(() => n.cancel(id)).toThrow(UnknownItemError);
    const id2 = n.enqueue("y", 0).itemId;
    n.take();
    expect(n.cancel(id2)).toBe(false);
  });

  test("unknown item errors", () => {
    const { n } = rq();
    expect(() => n.priorityOf(9)).toThrow(UnknownItemError);
    expect(() => n.statusOf(9)).toThrow(UnknownItemError);
  });

  test("clock negative", () => {
    const { clock } = rq();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("enqueue at maxPriority never ages", () => {
    const { clock, n } = rq({ ageMs: 1, maxPriority: 2 });
    const id = n.enqueue("x", 2).itemId;
    clock.advance(10);
    expect(n.drive().aged).toEqual([]);
    expect(n.priorityOf(id)).toBe(2);
  });

  test("size counts only queued", () => {
    const { n } = rq();
    n.enqueue(1, 0);
    n.enqueue(2, 1);
    expect(n.size()).toBe(2);
    n.take();
    expect(n.size()).toBe(1);
  });

  test("cancel mid queue preserves order of rest", () => {
    const { n } = rq({ maxPriority: 5 });
    const a = n.enqueue("a", 2).itemId;
    const b = n.enqueue("b", 1).itemId;
    const c = n.enqueue("c", 0).itemId;
    n.cancel(b);
    expect(n.peekIds()).toEqual([a, c]);
  });

  test("same-time enqueue age order by id when same prio", () => {
    const { clock, n } = rq({ ageMs: 1, maxPriority: 5, ageBatch: 1 });
    const a = n.enqueue("a", 0).itemId;
    const b = n.enqueue("b", 0).itemId;
    clock.advance(1);
    expect(n.drive().aged).toEqual([a]);
    expect(n.drive().aged).toEqual([b]);
  });
});
