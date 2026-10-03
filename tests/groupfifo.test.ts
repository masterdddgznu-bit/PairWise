import {
  VirtualClock,
  GroupFifo,
  InvalidConfigError,
  InvalidMessageError,
  UnknownReceiptError,
  ReceiptFenceError,
} from "../src/index.js";

function q(
  o: Partial<{
    visibilityMs: number;
    maxReceiveCount: number;
    dedupMs: number;
    maxReceiveBatch: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const g = new GroupFifo({
    clock,
    visibilityMs: o.visibilityMs ?? 10,
    maxReceiveCount: o.maxReceiveCount ?? 3,
    dedupMs: o.dedupMs ?? 100,
    maxReceiveBatch: o.maxReceiveBatch ?? 10,
  });
  return { clock, g };
}

describe("groupfifo hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new GroupFifo({ clock, visibilityMs: 0, maxReceiveCount: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new GroupFifo({ clock, visibilityMs: 1, maxReceiveCount: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("send/receive/delete happy path", () => {
    const { g } = q();
    const id = g.send("g1", "hello");
    expect(id).toBe("m1");
    const got = g.receive();
    expect(got).toHaveLength(1);
    expect(got[0]!.body).toBe("hello");
    expect(got[0]!.receiveCount).toBe(1);
    expect(g.delete(got[0]!.receipt, got[0]!.fence)).toBe(true);
    expect(g.receive()).toEqual([]);
  });

  test("FIFO within group: second blocked while first inflight", () => {
    const { g } = q();
    g.send("g1", "a");
    g.send("g1", "b");
    g.send("g2", "x");
    const batch = g.receive(2);
    expect(batch.map((m) => m.messageId)).toEqual(["m1", "m3"]);
    expect(g.approxReady()).toBe(0);
    g.delete(batch[0]!.receipt, batch[0]!.fence);
    const next = g.receive(2);
    expect(next.map((m) => m.messageId)).toEqual(["m2"]);
  });

  test("global oldest selectable across groups", () => {
    const { g } = q();
    g.send("b", "1");
    g.send("a", "2");
    const one = g.receive(1);
    expect(one[0]!.messageId).toBe("m1");
  });

  test("dedup returns same id inside window", () => {
    const { clock, g } = q({ dedupMs: 50 });
    const a = g.send("g", "x", { dedupId: "d1" });
    const b = g.send("g", "y", { dedupId: "d1" });
    expect(b).toBe(a);
    clock.advance(50);
    const c = g.send("g", "z", { dedupId: "d1" });
    expect(c).not.toBe(a);
  });

  test("delay then delayedReady via drive", () => {
    const { clock, g } = q();
    const id = g.send("g", "later", { delayMs: 20 });
    expect(g.receive()).toEqual([]);
    clock.advance(20);
    const rep = g.drive();
    expect(rep.delayedReady).toEqual([id]);
    expect(g.receive()[0]!.messageId).toBe(id);
  });

  test("visibility timeout requeues; stale receipt delete false", () => {
    const { clock, g } = q({ visibilityMs: 5, maxReceiveCount: 5 });
    g.send("g", "v");
    const [r] = g.receive();
    clock.advance(5);
    const rep = g.drive();
    expect(rep.requeued).toEqual([r!.messageId]);
    expect(g.delete(r!.receipt, r!.fence)).toBe(false);
    const [r2] = g.receive();
    expect(r2!.receiveCount).toBe(2);
    expect(r2!.receipt).not.toBe(r!.receipt);
  });

  test("maxReceiveCount sends to DLQ on visibility expiry", () => {
    const { clock, g } = q({ visibilityMs: 3, maxReceiveCount: 2 });
    g.send("g", "poison");
    for (let i = 0; i < 2; i++) {
      g.receive();
      clock.advance(3);
      g.drive();
    }
    expect(g.dlqIds()).toEqual(["m1"]);
    expect(g.receive()).toEqual([]);
  });

  test("changeVisibility extends; 0 expires next drive", () => {
    const { clock, g } = q({ visibilityMs: 100 });
    g.send("g", "x");
    const [r] = g.receive();
    expect(g.changeVisibility(r!.receipt, r!.fence, 0)).toBe(true);
    clock.advance(0);
    const rep = g.drive();
    expect(rep.requeued).toEqual(["m1"]);
  });

  test("bad fence / unknown receipt", () => {
    const { g } = q();
    g.send("g", "x");
    const [r] = g.receive();
    expect(() => g.delete(r!.receipt, r!.fence + 1)).toThrow(ReceiptFenceError);
    expect(() => g.delete("r999", 1)).toThrow(UnknownReceiptError);
  });

  test("invalid send/receive args", () => {
    const { g } = q({ maxReceiveBatch: 2 });
    expect(() => g.send("", "x")).toThrow(InvalidMessageError);
    expect(() => g.receive(0)).toThrow(InvalidMessageError);
    expect(() => g.receive(3)).toThrow(InvalidMessageError);
  });

  test("peekGroup order and inflightCount", () => {
    const { g } = q();
    g.send("g", "a");
    g.send("g", "b");
    expect(g.peekGroup("g")).toEqual(["m1", "m2"]);
    g.receive();
    expect(g.inflightCount()).toBe(1);
    expect(g.peekGroup("g")).toEqual(["m1", "m2"]);
  });

  test("interleaved: multi-group batch + requeue unlocks next in group", () => {
    const { clock, g } = q({ visibilityMs: 4, maxReceiveCount: 10 });
    g.send("g1", "a1");
    g.send("g1", "a2");
    g.send("g2", "b1");
    g.send("g3", "c1");
    const batch = g.receive(3);
    expect(batch.map((x) => x.groupId).sort()).toEqual(["g1", "g2", "g3"]);
    // delete g2, timeout g1 → g1's a1 requeued, a2 still blocked until a1 deleted/requeued cycle
    const g2 = batch.find((x) => x.groupId === "g2")!;
    g.delete(g2.receipt, g2.fence);
    clock.advance(4);
    const rep = g.drive();
    expect(rep.requeued).toContain("m1");
    const again = g.receive(3);
    const ids = again.map((x) => x.messageId);
    expect(ids).toContain("m1");
    expect(ids).not.toContain("m2");
  });

  test("dedup across delete still in window", () => {
    const { g } = q({ dedupMs: 1000 });
    const id = g.send("g", "a", { dedupId: "x" });
    const [r] = g.receive();
    g.delete(r!.receipt, r!.fence);
    expect(g.send("g", "b", { dedupId: "x" })).toBe(id);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("DLQ and requeue mixed in one drive", () => {
    const { clock, g } = q({ visibilityMs: 5, maxReceiveCount: 1 });
    g.send("g1", "old"); // will hit DLQ after 1 receive expiry
    g.send("g2", "new");
    const b = g.receive(2);
    expect(b).toHaveLength(2);
    clock.advance(5);
    const rep = g.drive();
    expect(rep.requeued).toEqual([]);
    expect(rep.deadLetter).toEqual(["m1", "m2"]);
  });

  test("approxReady ignores delayed and inflight groups", () => {
    const { g } = q();
    g.send("g1", "a");
    g.send("g1", "b");
    g.send("g2", "c", { delayMs: 10 });
    expect(g.approxReady()).toBe(1);
    g.receive(1);
    expect(g.approxReady()).toBe(0);
  });
});
