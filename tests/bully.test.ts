import {
  VirtualClock,
  Bully,
  OfflineError,
} from "../src/index.js";

function make(opts?: { nodeCount?: number; electionTimeout?: number }) {
  const clock = new VirtualClock();
  const b = new Bully({
    clock,
    nodeCount: opts?.nodeCount ?? 5,
    electionTimeout: opts?.electionTimeout ?? 5,
  });
  return { clock, b };
}

function electHighest(b: Bully, starter: number, clock: VirtualClock, max = 50) {
  b.startElection(starter);
  for (let i = 0; i < max; i++) {
    if (b.coordinator() !== null) return b.coordinator()!;
    b.tick();
  }
  throw new Error(`no coordinator at t=${clock.now()}`);
}

describe("bully basic", () => {
  test("highest node wins when lowest starts", () => {
    const { clock, b } = make({ nodeCount: 5, electionTimeout: 3 });
    const c = electHighest(b, 0, clock);
    expect(c).toBe(4);
    expect(b.state(4)).toBe("leading");
    expect(b.leaderOf(0)).toBe(4);
    expect(b.leaderOf(3)).toBe(4);
  });

  test("highest starting becomes coordinator immediately", () => {
    const { b } = make({ nodeCount: 4 });
    b.startElection(3);
    expect(b.coordinator()).toBe(3);
    expect(b.state(3)).toBe("leading");
    expect(b.leaderOf(1)).toBe(3);
  });

  test("offline cannot start", () => {
    const { b } = make();
    b.setOnline(2, false);
    expect(() => b.startElection(2)).toThrow(OfflineError);
  });

  test("initial state", () => {
    const { b } = make({ nodeCount: 3 });
    expect(b.coordinator()).toBeNull();
    expect(b.state(0)).toBe("idle");
    expect(b.leaderOf(0)).toBeNull();
  });
});

describe("bully timeout", () => {
  test("no higher node: mid node wins after timeout path", () => {
    const { clock, b } = make({ nodeCount: 5, electionTimeout: 2 });
    b.setOnline(3, false);
    b.setOnline(4, false);
    // 2 is highest online
    b.startElection(1);
    // 2 gets election, becomes coordinator immediately (no higher than 2)
    expect(b.coordinator()).toBe(2);
    expect(clock.now()).toBe(0);
  });

  test("gotOk waits then higher announces", () => {
    const { clock, b } = make({ nodeCount: 3, electionTimeout: 5 });
    b.startElection(0);
    // 1 and 2 receive election; 2 should become coordinator immediately
    expect(b.coordinator()).toBe(2);
    expect(b.leaderOf(0)).toBe(2);
    expect(clock.now()).toBe(0);
  });
});

describe("bully failover", () => {
  test("leader offline then re-elect", () => {
    const { clock, b } = make({ nodeCount: 5, electionTimeout: 3 });
    electHighest(b, 0, clock);
    expect(b.coordinator()).toBe(4);
    b.setOnline(4, false);
    expect(b.coordinator()).toBeNull();
    const c = electHighest(b, 1, clock);
    expect(c).toBe(3);
    expect(b.leaderOf(0)).toBe(3);
  });

  test("partitioned high nodes: lower wins among online", () => {
    const { clock, b } = make({ nodeCount: 5, electionTimeout: 2 });
    b.setOnline(4, false);
    b.setOnline(3, false);
    const c = electHighest(b, 0, clock);
    expect(c).toBe(2);
  });
});

describe("bully heal", () => {
  test("higher node comes online and takes over when election runs", () => {
    const { clock, b } = make({ nodeCount: 4, electionTimeout: 2 });
    b.setOnline(3, false);
    electHighest(b, 0, clock);
    expect(b.coordinator()).toBe(2);
    b.setOnline(3, true);
    // 3 does not auto-steal until election
    expect(b.coordinator()).toBe(2);
    b.startElection(1);
    expect(b.coordinator()).toBe(3);
    expect(b.leaderOf(2)).toBe(3);
  });
});

describe("bully tick idle", () => {
  test("tick advances clock", () => {
    const { clock, b } = make();
    b.tick();
    expect(clock.now()).toBe(1);
  });
});

describe("bully three nodes", () => {
  test("middle start yields highest", () => {
    const { clock, b } = make({ nodeCount: 3, electionTimeout: 4 });
    const c = electHighest(b, 1, clock);
    expect(c).toBe(2);
  });
});
