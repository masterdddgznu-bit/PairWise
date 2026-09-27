import {
  VirtualClock,
  RaftVote,
  majorityOf,
  hasQuorum,
  nextDeadline,
  InvalidNodeError,
} from "../src/index.js";

function make(opts?: {
  nodeCount?: number;
  electionTimeout?: number;
  heartbeatInterval?: number;
}) {
  const clock = new VirtualClock();
  const r = new RaftVote({
    clock,
    nodeCount: opts?.nodeCount ?? 5,
    electionTimeout: opts?.electionTimeout ?? 10,
    heartbeatInterval: opts?.heartbeatInterval ?? 3,
  });
  return { clock, r };
}

function tickUntilLeader(r: RaftVote, clock: VirtualClock, max = 200): number {
  for (let i = 0; i < max; i++) {
    r.tick();
    const lid = r.leaderId();
    if (lid !== null) return lid;
  }
  throw new Error(`no leader after ${max} ticks at t=${clock.now()}`);
}

describe("raftvote helpers", () => {
  test("majorityOf and hasQuorum", () => {
    expect(majorityOf(5)).toBe(3);
    expect(majorityOf(3)).toBe(2);
    expect(hasQuorum(3, 5)).toBe(true);
    expect(hasQuorum(2, 5)).toBe(false);
  });

  test("nextDeadline uses nodeId jitter", () => {
    expect(nextDeadline(0, 10, 0)).toBe(10);
    expect(nextDeadline(0, 10, 2)).toBe(12);
    expect(nextDeadline(5, 10, 1)).toBe(16);
  });
});

describe("raftvote bootstrap", () => {
  test("starts as followers term 0", () => {
    const { r } = make({ nodeCount: 3 });
    for (let i = 0; i < 3; i++) {
      expect(r.role(i)).toBe("follower");
      expect(r.term(i)).toBe(0);
      expect(r.votedFor(i)).toBeNull();
    }
    expect(r.leaderId()).toBeNull();
  });

  test("invalid node throws", () => {
    const { r } = make({ nodeCount: 3 });
    expect(() => r.role(9)).toThrow(InvalidNodeError);
  });

  test("elects leader after election timeout", () => {
    const { clock, r } = make({ nodeCount: 5, electionTimeout: 10 });
    const lid = tickUntilLeader(r, clock);
    expect(lid).toBe(0); // node 0 deadline fires first
    expect(r.role(0)).toBe("leader");
    expect(r.term(0)).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < 5; i++) {
      expect(r.role(i)).toBe("follower");
      expect(r.term(i)).toBe(r.term(0));
    }
  });
});

describe("raftvote heartbeat", () => {
  test("leader heartbeats prevent re-election", () => {
    const { clock, r } = make({
      nodeCount: 5,
      electionTimeout: 10,
      heartbeatInterval: 3,
    });
    const lid = tickUntilLeader(r, clock);
    const term = r.term(lid);
    for (let i = 0; i < 40; i++) r.tick();
    expect(r.leaderId()).toBe(lid);
    expect(r.term(lid)).toBe(term);
  });
});

describe("raftvote failover", () => {
  test("offline leader triggers new election", () => {
    const { clock, r } = make({ nodeCount: 5, electionTimeout: 8 });
    const old = tickUntilLeader(r, clock);
    r.setOnline(old, false);
    expect(r.leaderId()).toBeNull();
    const neu = tickUntilLeader(r, clock);
    expect(neu).not.toBe(old);
    expect(r.role(neu)).toBe("leader");
    expect(r.term(neu)).toBeGreaterThanOrEqual(r.term(old));
  });
});

describe("raftvote partition", () => {
  test("minority partition cannot elect", () => {
    const { clock, r } = make({ nodeCount: 5, electionTimeout: 6 });
    // isolate nodes 0,1 (minority)
    r.setOnline(2, false);
    r.setOnline(3, false);
    r.setOnline(4, false);
    for (let i = 0; i < 40; i++) r.tick();
    expect(r.leaderId()).toBeNull();
    expect(clock.now()).toBe(40);
  });

  test("majority partition elects", () => {
    const { clock, r } = make({ nodeCount: 5, electionTimeout: 6 });
    r.setOnline(0, false);
    r.setOnline(1, false);
    // online 2,3,4 majority
    const lid = tickUntilLeader(r, clock);
    expect([2, 3, 4]).toContain(lid);
  });
});

describe("raftvote voting rules", () => {
  test("node votes at most once per term", () => {
    const { clock, r } = make({ nodeCount: 3, electionTimeout: 5 });
    // Let node 0 become leade
    tickUntilLeader(r, clock);
    expect(r.votedFor(1)).toBe(0);
    expect(r.votedFor(2)).toBe(0);
  });

  test("candidate without quorum stays candidate then retries", () => {
    const { clock, r } = make({ nodeCount: 3, electionTimeout: 5 });
    r.setOnline(1, false);
    r.setOnline(2, false);
    // only node 0 online — cannot reach majority 2
    for (let i = 0; i < 5; i++) r.tick();
    // t=5: node0 deadline → candidate term1, only self vote
    expect(r.leaderId()).toBeNull();
    expect(r.role(0)).toBe("candidate");
    const t1 = r.term(0);
    // wait for next deadline: now=5, deadline=5+5+0=10
    for (let i = 0; i < 5; i++) r.tick();
    expect(r.term(0)).toBeGreaterThan(t1);
    expect(r.role(0)).toBe("candidate");
    expect(r.leaderId()).toBeNull();
  });
});

describe("raftvote three nodes", () => {
  test("elects with n=3", () => {
    const { clock, r } = make({ nodeCount: 3, electionTimeout: 7 });
    const lid = tickUntilLeader(r, clock);
    expect(r.role(lid)).toBe("leader");
    expect(r.leaderId()).toBe(lid);
  });
});

describe("raftvote heal partition", () => {
  test("after majority elects, healing minority follows higher term", () => {
    const { clock, r } = make({ nodeCount: 5, electionTimeout: 6 });
    r.setOnline(0, false);
    r.setOnline(1, false);
    const lid = tickUntilLeader(r, clock);
    const term = r.term(lid);
    r.setOnline(0, true);
    r.setOnline(1, true);
    for (let i = 0; i < 20; i++) r.tick();
    expect(r.leaderId()).toBe(lid);
    expect(r.term(0)).toBe(term);
    expect(r.term(1)).toBe(term);
    expect(r.role(0)).toBe("follower");
    expect(r.role(1)).toBe("follower");
  });
});
