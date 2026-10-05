import {
  DuplicateArriveError,
  InvalidConfigError,
  InvalidPartyError,
  JoinLatch,
  LateError,
  UnknownPartyError,
  VirtualClock,
} from "../src/index.js";

describe("joinlatch hell 0-1", () => {
  test("rejects invalid config including quorum XOR", () => {
    const clock = new VirtualClock();
    expect(
      () => new JoinLatch({ clock, parties: [], timeoutMs: 1, quorumCount: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new JoinLatch({
          clock,
          parties: ["a", "a"],
          timeoutMs: 1,
          quorumCount: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new JoinLatch({ clock, parties: ["a"], timeoutMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new JoinLatch({
          clock,
          parties: ["a", "b"],
          timeoutMs: 1,
          quorumCount: 1,
          quorumFraction: 0.5,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new JoinLatch({
          clock,
          parties: ["a", "b"],
          timeoutMs: 1,
          quorumCount: 3,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("quorumCount opens before all parties arrive", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b", "c"],
      timeoutMs: 100,
      quorumCount: 2,
    });
    expect(j.required()).toBe(2);
    expect(j.arrive("c")).toEqual({
      status: "accepted",
      remaining: 1,
      generation: 1,
    });
    expect(j.status()).toBe("pending");
    expect(j.arrive("a")).toEqual({
      status: "accepted",
      remaining: 0,
      generation: 1,
    });
    expect(j.status()).toBe("opened");
    expect(j.arrived()).toEqual(["c", "a"]);
    expect(j.missing()).toEqual(["b"]);
    expect(() => j.arrive("b")).toThrow(LateError);
  });

  test("quorumFraction ceil semantics", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b", "c"],
      timeoutMs: 10,
      quorumFraction: 0.5,
    });
    // ceil(1.5)=2
    expect(j.required()).toBe(2);
    j.arrive("a");
    expect(j.status()).toBe("pending");
    j.arrive("b");
    expect(j.status()).toBe("opened");
  });

  test("duplicate unknown empty party", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b"],
      timeoutMs: 10,
      quorumCount: 2,
    });
    j.arrive("a");
    expect(() => j.arrive("a")).toThrow(DuplicateArriveError);
    expect(() => j.arrive("z")).toThrow(UnknownPartyError);
    expect(() => j.arrive("")).toThrow(InvalidPartyError);
  });

  test("arrive after deadline still can open until drive", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b"],
      timeoutMs: 5,
      quorumCount: 2,
    });
    j.arrive("a");
    clock.advance(5);
    expect(j.status()).toBe("pending");
    expect(j.arrive("b").remaining).toBe(0);
    expect(j.status()).toBe("opened");
    expect(j.drive()).toEqual({ status: "opened" });
  });

  test("drive times out when below quorum at deadline", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b", "c"],
      timeoutMs: 5,
      quorumCount: 2,
    });
    j.arrive("a");
    clock.advance(4);
    expect(j.drive()).toEqual({ status: "pending" });
    clock.advance(1);
    expect(j.drive()).toEqual({ status: "timedOut" });
    expect(() => j.arrive("b")).toThrow(LateError);
  });

  test("exact boundary now === deadline times out on drive", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b"],
      timeoutMs: 7,
      quorumCount: 2,
    });
    clock.advance(7);
    expect(j.drive()).toEqual({ status: "timedOut" });
  });

  test("reset starts new generation; history via arrivedIn/wasPresent", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b", "c"],
      timeoutMs: 10,
      quorumCount: 2,
    });
    j.arrive("a");
    clock.advance(5);
    expect(j.reset()).toEqual({ generation: 2 });
    expect(j.status()).toBe("pending");
    expect(j.arrived()).toEqual([]);
    expect(j.deadline()).toBe(15);
    expect(j.arrivedIn(1)).toEqual(["a"]);
    expect(j.wasPresent("a", 1)).toBe(true);
    expect(j.wasPresent("a", 2)).toBe(false);
    j.arrive("b");
    expect(j.arrivedIn(2)).toEqual(["b"]);
  });

  test("reset after timeout allows reuse with quorumFraction", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b", "c", "d"],
      timeoutMs: 3,
      quorumFraction: 0.75,
    });
    // ceil(3)=3
    expect(j.required()).toBe(3);
    clock.advance(3);
    j.drive();
    j.reset();
    j.arrive("a");
    j.arrive("b");
    expect(j.status()).toBe("pending");
    j.arrive("c");
    expect(j.status()).toBe("opened");
  });

  test("missing follows parties() order", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["x", "y", "z"],
      timeoutMs: 20,
      quorumCount: 3,
    });
    j.arrive("z");
    expect(j.missing()).toEqual(["x", "y"]);
  });

  test("interleaved: pending drive, partial arrive, open before timeout", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["p", "q", "r"],
      timeoutMs: 10,
      quorumCount: 2,
    });
    j.arrive("q");
    clock.advance(9);
    expect(j.drive()).toEqual({ status: "pending" });
    expect(j.arrive("p").remaining).toBe(0);
    expect(j.status()).toBe("opened");
    expect(j.drive()).toEqual({ status: "opened" });
  });

  test("interleaved: gen1 timeout then gen2 open; history intact", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b"],
      timeoutMs: 4,
      quorumCount: 2,
    });
    j.arrive("a");
    clock.advance(4);
    j.drive();
    expect(j.status()).toBe("timedOut");
    j.reset();
    expect(j.generation()).toBe(2);
    j.arrive("b");
    j.arrive("a");
    expect(j.status()).toBe("opened");
    expect(j.arrivedIn(1)).toEqual(["a"]);
    expect(j.arrivedIn(2)).toEqual(["b", "a"]);
  });

  test("interleaved: fraction 1 requires all; late after open", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b", "c"],
      timeoutMs: 50,
      quorumFraction: 1,
    });
    expect(j.required()).toBe(3);
    j.arrive("a");
    j.arrive("b");
    expect(j.status()).toBe("pending");
    j.arrive("c");
    expect(j.status()).toBe("opened");
    expect(() => j.arrive("a")).toThrow(LateError);
  });

  test("interleaved: wasPresent errors and unknown generation", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b"],
      timeoutMs: 10,
      quorumCount: 1,
    });
    j.arrive("a");
    expect(j.status()).toBe("opened");
    expect(() => j.wasPresent("", 1)).toThrow(InvalidPartyError);
    expect(() => j.wasPresent("z", 1)).toThrow(UnknownPartyError);
    expect(j.arrivedIn(99)).toEqual([]);
    expect(j.wasPresent("b", 99)).toBe(false);
  });

  test("interleaved: reset mid-pending discards current arrivals only", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a", "b", "c"],
      timeoutMs: 8,
      quorumCount: 2,
    });
    j.arrive("c");
    j.arrive("a");
    expect(j.status()).toBe("opened");
    j.reset();
    expect(j.arrived()).toEqual([]);
    expect(j.missing()).toEqual(["a", "b", "c"]);
    expect(j.arrivedIn(1)).toEqual(["c", "a"]);
    expect(j.arrive("b").generation).toBe(2);
  });

  test("drive idempotent on terminal states", () => {
    const clock = new VirtualClock();
    const j = new JoinLatch({
      clock,
      parties: ["a"],
      timeoutMs: 5,
      quorumCount: 1,
    });
    j.arrive("a");
    expect(j.drive()).toEqual({ status: "opened" });
    expect(j.drive()).toEqual({ status: "opened" });
  });
});
