import {
  Barrier,
  BarrierError,
  EpochBarrier,
  StaleFenceError,
  VirtualClock,
} from "../src/index.js";

describe("epochbarr base Barrier", () => {
  test("initial remaining equals parties", () => {
    const b = new Barrier(3);
    expect(b.remaining()).toBe(3);
    expect(b.parties()).toBe(3);
  });

  test("arrive decrements remaining", () => {
    const b = new Barrier(3);
    expect(b.arrive()).toBe(2);
    expect(b.remaining()).toBe(2);
  });

  test("last arrive returns zero and resets", () => {
    const b = new Barrier(2);
    expect(b.arrive()).toBe(1);
    expect(b.arrive()).toBe(0);
    expect(b.remaining()).toBe(2);
  });

  test("parties stays constant", () => {
    const b = new Barrier(4);
    b.arrive();
    b.arrive();
    expect(b.parties()).toBe(4);
  });

  test("second cycle after reset", () => {
    const b = new Barrier(2);
    b.arrive();
    b.arrive();
    expect(b.arrive()).toBe(1);
    expect(b.arrive()).toBe(0);
  });

  test("partial arrives never zero", () => {
    const b = new Barrier(5);
    expect(b.arrive()).toBe(4);
    expect(b.arrive()).toBe(3);
    expect(b.remaining()).toBeGreaterThan(0);
  });
});

describe("epochbarr feature hell", () => {
  test("advance increments single node epoch", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    expect(eb.advance("a", 0)).toBe(1);
    expect(eb.epochOf("a")).toBe(1);
    expect(eb.epochOf("b")).toBe(0);
  });

  test("wait ready when all members reach epoch", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b", "c"]);
    eb.advance("a", 0);
    eb.advance("b", 0);
    expect(eb.wait(1)).toBe("pending");
    eb.advance("c", 0);
    expect(eb.wait(1)).toBe("ready");
  });

  test("wait pending when one member behind", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["x", "y"]);
    eb.advance("x", 0);
    expect(eb.wait(1)).toBe("pending");
  });

  test("waitUntil times out via clock advance", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.waitUntil(1, 50);
    expect(eb.wait(1)).toBe("pending");
    clock.advance(50);
    expect(eb.wait(1)).toBe("timedout");
  });

  test("tick allows timeout detection after advance", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.waitUntil(2, 10);
    eb.advance("a", 0);
    eb.advance("a", 0);
    clock.advance(5);
    eb.tick();
    expect(eb.wait(2)).toBe("pending");
    clock.advance(10);
    eb.tick();
    expect(eb.wait(2)).toBe("timedout");
  });

  test("join at minEpoch succeeds", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.advance("a", 0);
    expect(eb.minEpoch()).toBe(0);
    eb.join("c", 0);
    expect(eb.members()).toEqual(["a", "b", "c"]);
    expect(eb.epochOf("c")).toBe(0);
  });

  test("join stale epoch throws BarrierError", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.advance("a", 0);
    eb.advance("b", 0);
    expect(() => eb.join("c", 0)).toThrow(BarrierError);
  });

  test("leave removes member sorted list", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["b", "a", "c"]);
    eb.leave("b");
    expect(eb.members()).toEqual(["a", "c"]);
  });

  test("members returns sorted ids", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["z", "a", "m"]);
    expect(eb.members()).toEqual(["a", "m", "z"]);
  });

  test("minEpoch and epochOf track per node", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.advance("a", 0);
    eb.advance("a", 0);
    expect(eb.epochOf("a")).toBe(2);
    expect(eb.epochOf("b")).toBe(0);
    expect(eb.minEpoch()).toBe(0);
  });

  test("fence increments on join and leave", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    expect(eb.fence).toBe(0);
    eb.join("c", 0);
    expect(eb.fence).toBe(1);
    eb.leave("a");
    expect(eb.fence).toBe(2);
  });

  test("stale fence on advance throws", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.leave("b");
    expect(() => eb.advance("a", 0)).toThrow(StaleFenceError);
    expect(eb.advance("a", 1)).toBe(1);
  });

  test("advance unknown member throws BarrierError", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a"]);
    expect(() => eb.advance("z", 0)).toThrow(BarrierError);
  });

  test("leave unblocks wait when remainder caught up", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b", "c"]);
    eb.advance("a", 0);
    eb.advance("b", 0);
    expect(eb.wait(1)).toBe("pending");
    eb.leave("c");
    expect(eb.wait(1)).toBe("ready");
  });

  test("sequential multi-epoch barrier releases", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.advance("a", 0);
    eb.advance("b", 0);
    expect(eb.wait(1)).toBe("ready");
    expect(eb.wait(2)).toBe("pending");
    eb.advance("a", 0);
    eb.advance("b", 0);
    expect(eb.wait(2)).toBe("ready");
  });

  test("propose then ack advances epoch", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a", "b"]);
    eb.propose("a", 1);
    eb.ack("a", 1);
    eb.propose("b", 1);
    eb.ack("b", 1);
    expect(eb.wait(1)).toBe("ready");
  });

  test("invalid propose epoch throws", () => {
    const clock = new VirtualClock();
    const eb = new EpochBarrier(clock, ["a"]);
    expect(() => eb.propose("a", 2)).toThrow(BarrierError);
  });
});
