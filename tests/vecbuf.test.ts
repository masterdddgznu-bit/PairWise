import { VecBuf, VirtualClock } from "../src/index.js";

describe("vecbuf base", () => {
  test("send recv", () => {
    const b = new VecBuf(2);
    b.send(0, 1, "hi");
    expect(b.recv(1)).toEqual({ from: 0, payload: "hi" });
    expect(b.recv(1)).toBeNull();
  });

  test("inbox size", () => {
    const b = new VecBuf(2);
    b.send(0, 1, "a");
    b.send(0, 1, "b");
    expect(b.inboxSize(1)).toBe(2);
    b.recv(1);
    expect(b.inboxSize(1)).toBe(1);
  });

  test("unordered independent inboxes", () => {
    const b = new VecBuf(3);
    b.send(0, 1, "x");
    b.send(0, 2, "y");
    expect(b.recv(2)?.payload).toBe("y");
    expect(b.recv(1)?.payload).toBe("x");
  });

  test("empty recv null", () => {
    const b = new VecBuf(2);
    expect(b.recv(0)).toBeNull();
  });

  test("multiple messages fifo in base mailbox", () => {
    const b = new VecBuf(2);
    b.send(0, 1, "a");
    b.send(0, 1, "b");
    expect(b.recv(1)?.payload).toBe("a");
    expect(b.recv(1)?.payload).toBe("b");
  });

  test("self send allowed in base", () => {
    const b = new VecBuf(1);
    b.send(0, 0, "loop");
    expect(b.recv(0)).toEqual({ from: 0, payload: "loop" });
  });
});

describe("vecbuf feature hell", () => {
  test("broadcast delivers in causal order", () => {
    const b = new VecBuf(3);
    const m0 = b.broadcast(0, "a");
    b.receive(1, m0);
    b.receive(2, m0);
    expect(b.deliver(1)?.payload).toBe("a");
    expect(b.deliver(2)?.payload).toBe("a");
  });

  test("buffers until dependency satisfied", () => {
    const b = new VecBuf(3);
    const m0 = b.broadcast(0, "a");
    const m1 = b.broadcast(0, "b");
    // node 1 gets m1 first
    b.receive(1, m1);
    expect(b.deliver(1)).toBeNull();
    expect(b.buffered(1)).toBe(1);
    b.receive(1, m0);
    expect(b.deliverAll(1).map((m) => m.payload)).toEqual(["a", "b"]);
    expect(b.buffered(1)).toBe(0);
  });

  test("cross-sender causal dependency", () => {
    const b = new VecBuf(3);
    const a1 = b.broadcast(0, "from0");
    b.receive(1, a1);
    b.deliver(1);
    // node1 must have delivered a1 before its broadcast can be delivered elsewhere with dep
    // Simulate: node1 broadcasts after delivering — use receive path:
    // Manually: after deliver, broadcast from 1
    const b1 = b.broadcast(1, "from1");
    // node2 gets b1 before a1
    b.receive(2, b1);
    expect(b.deliver(2)).toBeNull();
    b.receive(2, a1);
    expect(b.deliverAll(2).map((m) => m.payload)).toEqual(["from0", "from1"]);
  });

  test("duplicate receive ignored", () => {
    const b = new VecBuf(2);
    const m = b.broadcast(0, "x");
    b.receive(1, m);
    b.receive(1, m);
    expect(b.buffered(1)).toBe(1);
    b.deliver(1);
    b.receive(1, m);
    expect(b.buffered(1)).toBe(0);
    expect(b.deliver(1)).toBeNull();
  });

  test("missing detects hole", () => {
    const b = new VecBuf(2);
    const m1 = b.broadcast(0, "a");
    const m2 = b.broadcast(0, "b");
    b.receive(1, m2);
    expect(b.missing(1)).toEqual([{ from: 0, seq: 1 }]);
    void m1;
  });

  test("repair timeout via tick", () => {
    const clock = new VirtualClock();
    const b = new VecBuf(2, clock, { repairTimeoutMs: 10 });
    const m1 = b.broadcast(0, "a");
    const m2 = b.broadcast(0, "b");
    b.receive(1, m2);
    clock.advance(10);
    b.tick();
    expect(b.pendingRepairs()).toEqual([
      { to: 1, missing: [{ from: 0, seq: 1 }] },
    ]);
    expect(b.pendingRepairs()).toEqual([]);
    void m1;
  });

  test("repair not before timeout", () => {
    const clock = new VirtualClock();
    const b = new VecBuf(2, clock, { repairTimeoutMs: 10 });
    const m2 = b.broadcast(0, "a");
    b.broadcast(0, "b");
    // only deliver second to create hole — need seq 2 without seq 1
    const all = [m2];
    // get second message by broadcasting twice and receiving only second
    const b2 = new VecBuf(2, clock, { repairTimeoutMs: 10 });
    b2.broadcast(0, "a");
    const second = b2.broadcast(0, "b");
    b2.receive(1, second);
    clock.advance(9);
    b2.tick();
    expect(b2.pendingRepairs()).toEqual([]);
    void all;
  });

  test("deliverAll preference from then seq", () => {
    const b = new VecBuf(3);
    const m0 = b.broadcast(0, "0");
    const m1 = b.broadcast(1, "1");
    b.receive(2, m1);
    b.receive(2, m0);
    // both ready (no cross deps): from 0 first
    expect(b.deliver(2)?.from).toBe(0);
    expect(b.deliver(2)?.from).toBe(1);
  });

  test("deliveredClock updates", () => {
    const b = new VecBuf(2);
    const m = b.broadcast(0, "x");
    b.receive(1, m);
    b.deliver(1);
    expect(b.deliveredClock(1)).toEqual([1, 0]);
  });

  test("ack and minStableClock", () => {
    const b = new VecBuf(3);
    b.ack(0, [1, 0, 0]);
    b.ack(1, [1, 1, 0]);
    b.ack(2, [2, 0, 0]);
    expect(b.minStableClock()).toEqual([1, 0, 0]);
  });

  test("gc drops buffered covered by stable", () => {
    const b = new VecBuf(2);
    b.broadcast(0, "a");
    const m2 = b.broadcast(0, "b");
    b.receive(1, m2);
    expect(b.buffered(1)).toBe(1);
    b.ack(0, [2, 0]);
    b.ack(1, [2, 0]);
    expect(b.minStableClock()).toEqual([2, 0]);
    b.gc();
    expect(b.buffered(1)).toBe(0);
  });

  test("self broadcast increments clock", () => {
    const b = new VecBuf(2);
    const m = b.broadcast(0, "x");
    expect(m.vc[0]).toBe(1);
    expect(b.deliveredClock(0)[0]).toBe(1);
  });

  test("three message chain hole", () => {
    const b = new VecBuf(2);
    b.broadcast(0, "a");
    b.broadcast(0, "b");
    const m3 = b.broadcast(0, "c");
    b.receive(1, m3);
    expect(b.missing(1)).toEqual([
      { from: 0, seq: 1 },
      { from: 0, seq: 2 },
    ]);
  });

  test("fill hole then deliverAll", () => {
    const b = new VecBuf(2);
    const m1 = b.broadcast(0, "a");
    const m2 = b.broadcast(0, "b");
    b.receive(1, m2);
    b.receive(1, m1);
    expect(b.deliverAll(1).map((x) => x.payload)).toEqual(["a", "b"]);
  });

  test("repair resets until next timeout", () => {
    const clock = new VirtualClock();
    const b = new VecBuf(2, clock, { repairTimeoutMs: 5 });
    b.broadcast(0, "a");
    const m2 = b.broadcast(0, "b");
    b.receive(1, m2);
    clock.advance(5);
    b.tick();
    expect(b.pendingRepairs()).toHaveLength(1);
    clock.advance(4);
    b.tick();
    expect(b.pendingRepairs()).toEqual([]);
    clock.advance(1);
    b.tick();
    expect(b.pendingRepairs()).toHaveLength(1);
  });

  test("independent of base mailbox", () => {
    const b = new VecBuf(2);
    b.send(0, 1, "mail");
    const m = b.broadcast(0, "causal");
    b.receive(1, m);
    expect(b.recv(1)?.payload).toBe("mail");
    expect(b.deliver(1)?.payload).toBe("causal");
  });

  test("vc length equals n", () => {
    const b = new VecBuf(4);
    const m = b.broadcast(2, "z");
    expect(m.vc).toHaveLength(4);
    expect(m.from).toBe(2);
    expect(m.seq).toBe(1);
  });
});
