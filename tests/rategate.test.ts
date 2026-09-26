import {
  CircuitOpenError,
  CompactedError,
  RateGate,
  UnknownClientError,
  VirtualClock,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const gate = new RateGate(clock);
  return { clock, gate };
}

describe("rategate base fixed-window", () => {
  test("register allow within limit", () => {
    const { gate } = setup();
    gate.register("a", 2, 100);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(true);
    expect(gate.remaining("a")).toBe(0);
  });

  test("deny when window exhausted", () => {
    const { gate } = setup();
    gate.register("a", 1, 100);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
  });

  test("window rolls after advance", () => {
    const { clock, gate } = setup();
    gate.register("a", 1, 50);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    clock.advance(50);
    expect(gate.allow("a")).toBe(true);
  });

  test("clients sorted; unregister; unknown throws", () => {
    const { gate } = setup();
    gate.register("b", 1, 10);
    gate.register("a", 1, 10);
    expect(gate.clients()).toEqual(["a", "b"]);
    gate.unregister("a");
    expect(gate.clients()).toEqual(["b"]);
    expect(() => gate.allow("a")).toThrow(UnknownClientError);
  });

  test("reregister resets window usage", () => {
    const { gate } = setup();
    gate.register("a", 1, 100);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    gate.register("a", 2, 100);
    expect(gate.remaining("a")).toBe(2);
    expect(gate.allow("a")).toBe(true);
  });
});

describe("rategate feature iteration", () => {
  test("token bucket refill and capacity", () => {
    const { clock, gate } = setup();
    gate.register("a", 100, 1000);
    gate.setTokenBucket("a", 2, 0.1);
    expect(gate.remaining("a")).toBe(2);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    clock.advance(10);
    expect(gate.remaining("a")).toBe(1);
    expect(gate.allow("a")).toBe(true);
  });

  test("quota gates independently of rate", () => {
    const { clock, gate } = setup();
    gate.register("a", 10, 1000);
    gate.setQuota("a", 2, 100);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    expect(gate.quotaRemaining("a")).toBe(0);
    expect(gate.remaining("a")).toBe(8);
    clock.advance(100);
    expect(gate.quotaRemaining("a")).toBe(2);
    expect(gate.allow("a")).toBe(true);
  });

  test("deny does not consume rate or quota when either side fails", () => {
    const { gate } = setup();
    gate.register("a", 2, 1000);
    gate.setQuota("a", 1, 1000);
    expect(gate.allow("a")).toBe(true);
    expect(gate.remaining("a")).toBe(1);
    expect(gate.quotaRemaining("a")).toBe(0);
    expect(gate.allow("a")).toBe(false);
    expect(gate.remaining("a")).toBe(1);
  });

  test("circuit opens after consecutive denials and cools down", () => {
    const { clock, gate } = setup();
    gate.register("a", 1, 1000);
    gate.setCircuit("a", 2, 30);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    expect(gate.allow("a")).toBe(false);
    expect(() => gate.allow("a")).toThrow(CircuitOpenError);
    clock.advance(30);
    expect(gate.allow("a")).toBe(false);
  });

  test("watch receives allow deny and circuit_open", () => {
    const { gate } = setup();
    gate.register("a", 1, 1000);
    gate.setCircuit("a", 1, 50);
    const id = gate.watch(0);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    expect(() => gate.allow("a")).toThrow(CircuitOpenError);
    const ev = gate.pollWatch(id);
    expect(ev.map((e) => e.type)).toEqual(["allow", "deny", "circuit_open", "circuit_open"]);
    expect(ev.every((e) => e.clientId === "a")).toBe(true);
    expect(gate.currentSeq()).toBe(4);
  });

  test("batchAllow all-or-nothing without partial consume", () => {
    const { gate } = setup();
    gate.register("a", 1, 1000);
    gate.register("b", 1, 1000);
    expect(gate.batchAllow(["a", "b"])).toBe(true);
    expect(gate.remaining("a")).toBe(0);
    expect(gate.remaining("b")).toBe(0);
    gate.register("c", 1, 1000);
    gate.register("d", 0, 1000);
    const beforeC = gate.remaining("c");
    expect(gate.batchAllow(["c", "d"])).toBe(false);
    expect(gate.remaining("c")).toBe(beforeC);
  });

  test("batchAllow throws on open circuit without consuming", () => {
    const { gate } = setup();
    gate.register("a", 1, 1000);
    gate.register("b", 5, 1000);
    gate.setCircuit("a", 1, 100);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    const before = gate.remaining("b");
    expect(() => gate.batchAllow(["b", "a"])).toThrow(CircuitOpenError);
    expect(gate.remaining("b")).toBe(before);
  });

  test("refund restores window and quota", () => {
    const { gate } = setup();
    gate.register("a", 2, 1000);
    gate.setQuota("a", 2, 1000);
    expect(gate.allow("a")).toBe(true);
    expect(gate.remaining("a")).toBe(1);
    expect(gate.quotaRemaining("a")).toBe(1);
    gate.refund("a");
    expect(gate.remaining("a")).toBe(2);
    expect(gate.quotaRemaining("a")).toBe(2);
  });

  test("refund restores token bucket", () => {
    const { gate } = setup();
    gate.register("a", 10, 1000);
    gate.setTokenBucket("a", 3, 0);
    expect(gate.allow("a")).toBe(true);
    expect(gate.remaining("a")).toBe(2);
    gate.refund("a", 2);
    expect(gate.remaining("a")).toBe(3);
  });

  test("compact then watch old fromSeq throws", () => {
    const { gate } = setup();
    gate.register("a", 5, 1000);
    gate.allow("a");
    gate.allow("a");
    const seq = gate.currentSeq();
    gate.compact(seq);
    expect(() => gate.watch(0)).toThrow(CompactedError);
    const id = gate.watch(seq);
    gate.allow("a");
    const ev = gate.pollWatch(id);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("allow");
  });

  test("token + quota + events coupling", () => {
    const { clock, gate } = setup();
    gate.register("a", 100, 1000);
    gate.setTokenBucket("a", 1, 0.05);
    gate.setQuota("a", 2, 200);
    const id = gate.watch(0);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    clock.advance(20);
    expect(gate.allow("a")).toBe(true);
    expect(gate.allow("a")).toBe(false);
    expect(gate.quotaRemaining("a")).toBe(0);
    const types = gate.pollWatch(id).map((e) => e.type);
    expect(types).toEqual(["allow", "deny", "allow", "deny"]);
  });
});
