import { RaftNode } from "../src/raft_node.js";
import { emptyPersist, type Persist } from "../src/types.js";

function node(id: string, persist: Persist, peers: string[] = []) {
  const applied: string[] = [];
  const n = new RaftNode({
    id,
    peerIds: peers,
    persist,
    electionTimeoutMs: 10,
    onApply: (c) => applied.push(c),
  });
  return { n, applied, persist };
}

describe("RaftNode", () => {
  test("single node times out, becomes leader, commits current term", () => {
    const { n, applied } = node("n1", emptyPersist());
    n.tick(9);
    expect(n.role()).toBe("follower");
    n.tick(1);
    expect(n.role()).toBe("leader");
    expect(n.currentTerm()).toBe(1);
    const put = n.propose("a");
    expect(put).toEqual({ index: 1, term: 1 });
    expect(n.commitIndex()).toBe(1);
    expect(applied).toEqual(["a"]);
  });

  test("old-term entries commit only after a current-term entry", () => {
    const persist = emptyPersist();
    persist.currentTerm = 1;
    persist.log = [{ index: 1, term: 1, command: "old" }];
    const { n, applied } = node("n1", persist);
    n.tick(10);
    expect(n.role()).toBe("leader");
    expect(n.currentTerm()).toBe(2);
    expect(n.commitIndex()).toBe(0);
    expect(applied).toEqual([]);
    expect(n.propose("new")).toEqual({ index: 2, term: 2 });
    expect(n.commitIndex()).toBe(2);
    expect(applied).toEqual(["old", "new"]);
  });

  test("appendEntries truncates conflicts and reports conflictIndex", () => {
    const persist = emptyPersist();
    persist.currentTerm = 2;
    persist.log = [
      { index: 1, term: 1, command: "a" },
      { index: 2, term: 1, command: "b" },
    ];
    const { n } = node("f", persist, ["l"]);
    const bad = n.appendEntries({
      term: 3,
      leaderId: "l",
      prevLogIndex: 2,
      prevLogTerm: 2,
      entries: [{ term: 3, command: "c" }],
      leaderCommit: 1,
    });
    expect(bad.success).toBe(false);
    expect(bad.conflictIndex).toBe(2);
    expect(n.role()).toBe("follower");
    expect(n.currentTerm()).toBe(3);

    const ok = n.appendEntries({
      term: 3,
      leaderId: "l",
      prevLogIndex: 1,
      prevLogTerm: 1,
      entries: [{ term: 3, command: "c" }],
      leaderCommit: 2,
    });
    expect(ok.success).toBe(true);
    expect(persist.log.map((e) => e.command)).toEqual(["a", "c"]);
    expect(n.commitIndex()).toBe(2);
  });

  test("grant vote only when candidate log is up to date", () => {
    const persist = emptyPersist();
    persist.currentTerm = 1;
    persist.log = [{ index: 1, term: 1, command: "a" }];
    const { n } = node("f", persist, ["c1", "c2"]);
    const behind = n.requestVote({
      term: 2,
      candidateId: "c1",
      lastLogIndex: 0,
      lastLogTerm: 0,
    });
    expect(behind.voteGranted).toBe(false);
    const ahead = n.requestVote({
      term: 2,
      candidateId: "c2",
      lastLogIndex: 1,
      lastLogTerm: 1,
    });
    expect(ahead.voteGranted).toBe(true);
    const again = n.requestVote({
      term: 2,
      candidateId: "c1",
      lastLogIndex: 5,
      lastLogTerm: 2,
    });
    expect(again.voteGranted).toBe(false);
  });

  test("installSnapshot applies data once and drops prefix", () => {
    const persist = emptyPersist();
    persist.log = [
      { index: 1, term: 1, command: "a" },
      { index: 2, term: 1, command: "b" },
    ];
    const { n, applied } = node("f", persist, ["l"]);
    n.installSnapshot({
      term: 2,
      leaderId: "l",
      lastIncludedIndex: 2,
      lastIncludedTerm: 1,
      data: "snap-ab",
    });
    expect(applied).toEqual(["snap-ab"]);
    expect(persist.log).toEqual([]);
    expect(persist.lastApplied).toBe(2);
    expect(n.commitIndex()).toBeGreaterThanOrEqual(2);
    n.installSnapshot({
      term: 2,
      leaderId: "l",
      lastIncludedIndex: 2,
      lastIncludedTerm: 1,
      data: "snap-ab",
    });
    expect(applied).toEqual(["snap-ab"]);
  });

  test("crash and recover does not reapply", () => {
    const persist = emptyPersist();
    const applied: string[] = [];
    const opts = {
      id: "n1",
      peerIds: [] as string[],
      persist,
      electionTimeoutMs: 10,
      onApply: (c: string) => applied.push(c),
    };
    const n = new RaftNode(opts);
    n.tick(10);
    n.propose("a");
    expect(applied).toEqual(["a"]);
    n.crash();
    const n2 = RaftNode.recover(opts);
    expect(n2.role()).toBe("follower");
    expect(applied).toEqual(["a"]);
    n2.tick(10);
    expect(n2.role()).toBe("leader");
    n2.propose("b");
    expect(applied).toEqual(["a", "b"]);
    expect(n2.propose("nope-if-follower")).not.toBeNull();
  });

  test("non-leader propose returns null", () => {
    const { n } = node("f", emptyPersist(), ["other"]);
    expect(n.propose("x")).toBeNull();
  });
});
