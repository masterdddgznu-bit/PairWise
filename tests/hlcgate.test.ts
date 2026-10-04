import {
  VirtualClock,
  HlcGate,
  InvalidConfigError,
  InvalidMessageError,
  UnknownMessageError,
} from "../src/index.js";

function hg(
  o: Partial<{
    nodeId: string;
    waitMs: number;
    onTimeout: "drop" | "force";
  }> = {},
) {
  const clock = new VirtualClock();
  const n = new HlcGate({
    clock,
    nodeId: o.nodeId ?? "n1",
    waitMs: o.waitMs ?? 10,
    onTimeout: o.onTimeout ?? "drop",
  });
  return { clock, n };
}

describe("hlcgate hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new HlcGate({
          clock,
          nodeId: "",
          waitMs: 1,
          onTimeout: "drop",
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new HlcGate({
          clock,
          nodeId: "n",
          waitMs: 0,
          onTimeout: "drop",
        }),
    ).toThrow(InvalidConfigError);
  });

  test("stamp advances logical on same wall", () => {
    const { n } = hg();
    expect(n.nowHlc()).toEqual({ wall: 0, logical: 0 });
    const a = n.stamp();
    const b = n.stamp();
    expect(a).toEqual({ wall: 0, logical: 1 });
    expect(b).toEqual({ wall: 0, logical: 2 });
  });

  test("stamp jumps wall with clock", () => {
    const { clock, n } = hg();
    n.stamp();
    clock.advance(5);
    expect(n.stamp()).toEqual({ wall: 5, logical: 0 });
  });

  test("observe merges remote", () => {
    const { clock, n } = hg();
    clock.advance(1);
    n.stamp();
    const r = n.observe({ wall: 10, logical: 3 });
    expect(r).toEqual({ wall: 10, logical: 4 });
  });

  test("publish ready without deps; drive delivers by stamp", () => {
    const { n } = hg();
    const a = n.publish("k", 1);
    const b = n.publish("k", 2);
    expect(n.statusOf(a.msgId)).toBe("ready");
    const d = n.drive();
    expect(d.delivered).toEqual([a.msgId, b.msgId]);
    expect(n.statusOf(a.msgId)).toBe("delivered");
  });

  test("blocked until dep delivered; manual deliver wakes", () => {
    const { n } = hg();
    const a = n.publish("k", "A");
    const b = n.publish("k", "B", [a.msgId]);
    expect(n.statusOf(b.msgId)).toBe("blocked");
    expect(n.deliverable()).toEqual([a.msgId]);
    expect(n.deliver(a.msgId)).toBe("A");
    expect(n.statusOf(b.msgId)).toBe("ready");
    expect(n.drive().delivered).toEqual([b.msgId]);
  });

  test("drive auto delivers chain in one call", () => {
    const { n } = hg();
    const a = n.publish("k", 1);
    const b = n.publish("k", 2, [a.msgId]);
    const c = n.publish("k", 3, [b.msgId]);
    expect(n.drive().delivered).toEqual([a.msgId, b.msgId, c.msgId]);
  });

  test("timeout drop", () => {
    const { clock, n } = hg({ waitMs: 4, onTimeout: "drop" });
    const a = n.publish("k", 1);
    const b = n.publish("k", 2, [a.msgId]);
    clock.advance(4);
    // keep a undelivered; b times out
    const d = n.drive();
    expect(d.dropped).toEqual([b.msgId]);
    expect(d.delivered).toEqual([a.msgId]);
    expect(n.statusOf(b.msgId)).toBe("dropped");
  });

  test("timeout force then deliver", () => {
    const { clock, n } = hg({ waitMs: 3, onTimeout: "force" });
    expect(() => n.publish("k", 2, ["n1:999"])).toThrow(InvalidMessageError);
    const a = n.publish("k", 1);
    const b = n.publish("k", 2, [a.msgId]);
    clock.advance(3);
    const d = n.drive();
    expect(d.dropped).toEqual([]);
    expect(d.delivered).toEqual([a.msgId, b.msgId]);
  });

  test("force delivers blocked even if dep still blocked chain root ready", () => {
    const { clock, n } = hg({ waitMs: 2, onTimeout: "force" });
    const a = n.publish("k", 1);
    const b = n.publish("k", 2, [a.msgId]);
    const c = n.publish("k", 3, [b.msgId]);
    clock.advance(2);
    expect(n.drive().delivered).toEqual([a.msgId, b.msgId, c.msgId]);
  });

  test("unknown message; empty key; clock negative", () => {
    const { clock, n } = hg();
    expect(() => n.statusOf("x")).toThrow(UnknownMessageError);
    expect(() => n.publish("", 1)).toThrow(InvalidMessageError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("deliver not ready throws; double deliver throws", () => {
    const { n } = hg();
    const a = n.publish("k", 1);
    const b = n.publish("k", 2, [a.msgId]);
    expect(() => n.deliver(b.msgId)).toThrow(InvalidMessageError);
    n.deliver(a.msgId);
    n.deliver(b.msgId);
    expect(() => n.deliver(b.msgId)).toThrow(InvalidMessageError);
  });

  test("msgId format and depsOf sorted", () => {
    const { n } = hg({ nodeId: "node" });
    const a = n.publish("k", 1);
    const b = n.publish("k", 2);
    const c = n.publish("k", 3, [b.msgId, a.msgId]);
    expect(a.msgId).toBe("node:1");
    expect(c.msgId).toBe("node:3");
    expect(n.depsOf(c.msgId)).toEqual([a.msgId, b.msgId]);
  });

  test("observe same wall bumps logical past both", () => {
    const { n } = hg();
    n.observe({ wall: 0, logical: 5 });
    expect(n.nowHlc()).toEqual({ wall: 0, logical: 6 });
  });

  test("deliverable order by stamp then id", () => {
    const { clock, n } = hg();
    const a = n.publish("k", 1);
    clock.advance(1);
    const b = n.publish("k", 2);
    expect(n.deliverable()).toEqual([a.msgId, b.msgId]);
    expect(n.stampOf(b.msgId).wall).toBe(1);
  });
});
