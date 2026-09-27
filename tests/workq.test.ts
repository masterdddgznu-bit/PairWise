import {
  CompactedError,
  VirtualClock,
  WorkQueue,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const q = new WorkQueue(clock);
  return { clock, q };
}

describe("workq base fifo", () => {
  test("enqueue dequeue ack", () => {
    const { q } = setup();
    const id = q.enqueue("a");
    expect(id).toBe("1");
    expect(q.size()).toBe(1);
    const m = q.dequeue();
    expect(m).toEqual({
      id: "1",
      payload: "a",
      priority: 0,
      attempts: 0,
      enqueuedAt: 0,
    });
    expect(q.size()).toBe(0);
    expect(q.ack("1")).toBe(true);
    expect(q.ack("1")).toBe(false);
  });

  test("fifo order", () => {
    const { q } = setup();
    q.enqueue("a");
    q.enqueue("b");
    expect(q.dequeue()?.payload).toBe("a");
    expect(q.dequeue()?.payload).toBe("b");
  });

  test("dequeue empty null", () => {
    const { q } = setup();
    expect(q.dequeue()).toBeNull();
  });

  test("size counts waiting only", () => {
    const { q } = setup();
    q.enqueue("a");
    q.enqueue("b");
    q.dequeue();
    expect(q.size()).toBe(1);
  });

  test("ids monotonic", () => {
    const { q } = setup();
    expect(q.enqueue("a")).toBe("1");
    expect(q.enqueue("b")).toBe("2");
  });
});

describe("workq feature iteration", () => {
  test("priority ordering stable", () => {
    const { q } = setup();
    q.enqueue("low", { priority: 1 });
    q.enqueue("high", { priority: 5 });
    q.enqueue("mid", { priority: 3 });
    q.enqueue("high2", { priority: 5 });
    expect(q.dequeue()?.payload).toBe("high");
    expect(q.dequeue()?.payload).toBe("high2");
    expect(q.dequeue()?.payload).toBe("mid");
    expect(q.dequeue()?.payload).toBe("low");
  });

  test("delay until clock advances", () => {
    const { clock, q } = setup();
    q.enqueue("later", { delayMs: 50 });
    expect(q.dequeue()).toBeNull();
    expect(q.size()).toBe(0);
    clock.advance(50);
    expect(q.size()).toBe(1);
    expect(q.dequeue()?.payload).toBe("later");
  });

  test("visibility timeout expire via tick", () => {
    const { clock, q } = setup();
    q.setVisibilityTimeout(10);
    q.enqueue("a");
    const m = q.dequeue()!;
    expect(q.size()).toBe(0);
    clock.advance(10);
    q.tick();
    expect(q.ack(m.id)).toBe(false);
    expect(q.dequeue()?.id).toBe(m.id);
  });

  test("visibility expire increments attempts", () => {
    const { clock, q } = setup();
    q.setVisibilityTimeout(5);
    q.enqueue("a");
    const id = q.dequeue()!.id;
    clock.advance(5);
    q.tick();
    const again = q.dequeue()!;
    expect(again.id).toBe(id);
    expect(again.attempts).toBe(1);
  });

  test("nack requeues with attempts", () => {
    const { q } = setup();
    q.enqueue("a");
    const id = q.dequeue()!.id;
    expect(q.nack(id)).toBe(true);
    expect(q.nack(id)).toBe(false);
    expect(q.dequeue()?.attempts).toBe(1);
  });

  test("dlq after maxAttempts and redrive", () => {
    const { q } = setup();
    q.setMaxAttempts(2);
    q.enqueue("a");
    const id = q.dequeue()!.id;
    q.nack(id);
    const id2 = q.dequeue()!.id;
    expect(id2).toBe(id);
    q.nack(id2);
    expect(q.dequeue()).toBeNull();
    expect(q.deadLetters().map((m) => m.id)).toEqual([id]);
    expect(q.deadLetters()[0]!.attempts).toBe(2);
    expect(q.redrive(id)).toBe(true);
    expect(q.dequeue()?.attempts).toBe(0);
  });

  test("watch events for enqueue dequeue ack nack", () => {
    const { q } = setup();
    const w = q.watch(0);
    const id = q.enqueue("a");
    q.dequeue();
    q.nack(id);
    q.dequeue();
    q.ack(id);
    const types = q.pollWatch(w).map((e) => e.type);
    expect(types).toEqual(["enqueue", "dequeue", "nack", "dequeue", "ack"]);
  });

  test("expire and dead events", () => {
    const { clock, q } = setup();
    q.setVisibilityTimeout(5);
    q.setMaxAttempts(1);
    const w = q.watch(0);
    const id = q.enqueue("a");
    q.dequeue();
    q.pollWatch(w);
    clock.advance(5);
    q.tick();
    const types = q.pollWatch(w).map((e) => e.type);
    expect(types).toEqual(["expire", "dead"]);
    expect(q.deadLetters()[0]!.id).toBe(id);
  });

  test("batchDequeue respects priority and limit", () => {
    const { q } = setup();
    q.enqueue("a", { priority: 1 });
    q.enqueue("b", { priority: 3 });
    q.enqueue("c", { priority: 2 });
    const batch = q.batchDequeue(2);
    expect(batch.map((m) => m.payload)).toEqual(["b", "c"]);
    expect(q.size()).toBe(1);
  });

  test("compact then watch old throws", () => {
    const { q } = setup();
    q.enqueue("a");
    q.enqueue("b");
    const seq = q.currentSeq();
    q.compact(seq);
    expect(() => q.watch(0)).toThrow(CompactedError);
    const w = q.watch(seq);
    q.enqueue("c");
    expect(q.pollWatch(w)).toHaveLength(1);
  });

  test("delay + priority + visibility coupling", () => {
    const { clock, q } = setup();
    q.setVisibilityTimeout(10);
    q.enqueue("slow-high", { priority: 9, delayMs: 20 });
    q.enqueue("now-low", { priority: 1 });
    expect(q.dequeue()?.payload).toBe("now-low");
    clock.advance(20);
    const m = q.dequeue()!;
    expect(m.payload).toBe("slow-high");
    clock.advance(10);
    q.tick();
    expect(q.dequeue()?.payload).toBe("slow-high");
  });
});
