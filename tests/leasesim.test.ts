import {
  Client,
  LeaderElection,
  LeaseManager,
  VirtualClock,
  AlreadyHeldError,
  NotOwnerError,
  StaleTokenError,
  LeaseNotFoundError,
  NotLeaderError,
} from "../src/index.js";

function setup() {
  const clock = new VirtualClock();
  const manager = new LeaseManager(clock);
  return { clock, manager };
}

describe("leasesim", () => {
  test("VirtualClock now and advance", () => {
    const clock = new VirtualClock();
    expect(clock.now()).toBe(0);
    clock.advance(100);
    expect(clock.now()).toBe(100);
    clock.advance(50);
    expect(clock.now()).toBe(150);
  });

  test("acquire grants strictly increasing token per resource", () => {
    const { clock, manager } = setup();
    const a = manager.acquire("R", "owner-a", 100);
    expect(a.token).toBe(1);
    expect(a.expireAt).toBe(100);
    clock.advance(100);
    const b = manager.acquire("R", "owner-b", 50);
    expect(b.token).toBe(2);
    expect(b.expireAt).toBe(150);
  });

  test("acquire by other while valid lease throws AlreadyHeldError", () => {
    const { manager } = setup();
    manager.acquire("R", "A", 100);
    expect(() => manager.acquire("R", "B", 50)).toThrow(AlreadyHeldError);
  });

  test("same owner re-acquire renews in place keeping token", () => {
    const { clock, manager } = setup();
    const first = manager.acquire("R", "A", 100);
    clock.advance(30);
    const second = manager.acquire("R", "A", 200);
    expect(second.token).toBe(first.token);
    expect(second.expireAt).toBe(230);
    expect(manager.getLease("R")).toEqual({
      ownerId: "A",
      token: first.token,
      expireAt: 230,
    });
  });

  test("exact boundary: at expireAt lease expired and new acquire allowed", () => {
    const { clock, manager } = setup();
    const first = manager.acquire("R", "A", 100);
    clock.advance(100);
    expect(manager.getLease("R")).toBeNull();
    const second = manager.acquire("R", "B", 50);
    expect(second.token).toBe(first.token + 1);
    expect(manager.getLease("R")).toEqual({
      ownerId: "B",
      token: second.token,
      expireAt: 150,
    });
  });

  test("renew extends expireAt with matching owner and token", () => {
    const { clock, manager } = setup();
    const { token } = manager.acquire("R", "A", 100);
    clock.advance(40);
    const renewed = manager.renew("R", "A", token, 80);
    expect(renewed.expireAt).toBe(120);
    expect(manager.getLease("R")?.expireAt).toBe(120);
  });

  test("renew by non-owner throws NotOwnerError", () => {
    const { manager } = setup();
    const { token } = manager.acquire("R", "A", 100);
    expect(() => manager.renew("R", "B", token, 50)).toThrow(NotOwnerError);
  });

  test("renew with stale token throws StaleTokenError", () => {
    const { clock, manager } = setup();
    manager.acquire("R", "A", 100);
    clock.advance(100);
    const next = manager.acquire("R", "B", 100);
    expect(() => manager.renew("R", "B", next.token - 1, 50)).toThrow(
      StaleTokenError,
    );
  });

  test("release clears lease; wrong owner rejected", () => {
    const { manager } = setup();
    const { token } = manager.acquire("R", "A", 100);
    expect(() => manager.release("R", "B", token)).toThrow(NotOwnerError);
    manager.release("R", "A", token);
    expect(manager.getLease("R")).toBeNull();
  });

  test("A acquires, expires, B acquires; A stale write rejected", () => {
    const { clock, manager } = setup();
    const clientA = new Client("A", manager, clock);
    const clientB = new Client("B", manager, clock);
    const a = clientA.acquire("R", 100);
    clock.advance(100);
    const b = clientB.acquire("R", 100);
    expect(b.token).toBe(a.token + 1);
    expect(() => clientA.fencedWrite("R", a.token, "old")).toThrow(
      StaleTokenError,
    );
    clientB.fencedWrite("R", b.token, "new");
    expect(clientB.lastWrite("R")).toEqual({
      token: b.token,
      payload: "new",
      clientId: "B",
    });
  });

  test("after release old token write still rejected", () => {
    const { clock, manager } = setup();
    const clientA = new Client("A", manager, clock);
    const clientB = new Client("B", manager, clock);
    const a = clientA.acquire("R", 100);
    clock.advance(100);
    const b = clientB.acquire("R", 100);
    clientB.release("R", b.token);
    expect(manager.getLease("R")).toBeNull();
    expect(() => clientA.fencedWrite("R", a.token, "stale")).toThrow(
      StaleTokenError,
    );
    expect(() => clientB.fencedWrite("R", b.token, "also-stale")).toThrow(
      StaleTokenError,
    );
  });

  test("multi-resource independent token sequences", () => {
    const { clock, manager } = setup();
    const r1a = manager.acquire("R1", "A", 100);
    const r2a = manager.acquire("R2", "A", 100);
    expect(r1a.token).toBe(1);
    expect(r2a.token).toBe(1);
    clock.advance(100);
    const r1b = manager.acquire("R1", "B", 50);
    const r2b = manager.acquire("R2", "C", 50);
    expect(r1b.token).toBe(2);
    expect(r2b.token).toBe(2);
    expect(manager.getLease("R1")?.ownerId).toBe("B");
    expect(manager.getLease("R2")?.ownerId).toBe("C");
  });

  test("token monotonic across many acquire/release cycles", () => {
    const { clock, manager } = setup();
    const tokens: number[] = [];
    for (let i = 0; i < 5; i++) {
      const owner = `O${i}`;
      const { token } = manager.acquire("R", owner, 10);
      tokens.push(token);
      manager.release("R", owner, token);
      clock.advance(10);
    }
    expect(tokens).toEqual([1, 2, 3, 4, 5]);
  });

  test("client fencedWrite succeeds with valid active lease", () => {
    const { clock, manager } = setup();
    const client = new Client("writer", manager, clock);
    const { token } = client.acquire("doc", 100);
    client.fencedWrite("doc", token, "payload-v1");
    expect(client.lastWrite("doc")).toEqual({
      token,
      payload: "payload-v1",
      clientId: "writer",
    });
    clock.advance(50);
    const renewed = client.renew("doc", token, 100);
    client.fencedWrite("doc", token, "payload-v2");
    expect(client.lastWrite("doc")?.payload).toBe("payload-v2");
    expect(renewed.expireAt).toBe(150);
  });

  test("release with stale token throws StaleTokenError", () => {
    const { clock, manager } = setup();
    manager.acquire("R", "A", 100);
    clock.advance(100);
    const { token } = manager.acquire("R", "B", 100);
    expect(() => manager.release("R", "B", token - 1)).toThrow(
      StaleTokenError,
    );
  });

  test("leader election campaign, renew, write, stepDown", () => {
    const { clock, manager } = setup();
    const election = new LeaderElection("svc", manager, clock);
    const got = election.campaign("node-a", 100);
    expect(got).toEqual({ token: 1 });
    expect(election.leader()).toEqual({
      nodeId: "node-a",
      token: 1,
      expireAt: 100,
    });
    clock.advance(30);
    election.renew("node-a", 1, 100);
    expect(election.leader()?.expireAt).toBe(130);
    election.write("node-a", 1, "leader-data");
    expect(election.lastWrite()).toEqual({
      nodeId: "node-a",
      token: 1,
      payload: "leader-data",
    });
    election.stepDown("node-a", 1);
    expect(election.leader()).toBeNull();
  });

  test("leader stale write after re-election rejected", () => {
    const { clock, manager } = setup();
    const election = new LeaderElection("cluster", manager, clock);
    const a = election.campaign("A", 100);
    expect(a).toEqual({ token: 1 });
    election.write("A", 1, "from-A");
    clock.advance(100);
    expect(election.leader()).toBeNull();
    const b = election.campaign("B", 100);
    expect(b?.token).toBe(2);
    expect(() => election.write("A", 1, "stale-A")).toThrow(
      StaleTokenError,
    );
    expect(() => election.write("B", 1, "wrong-token")).toThrow(
      StaleTokenError,
    );
    election.write("B", 2, "from-B");
    expect(election.lastWrite()?.payload).toBe("from-B");
  });

  test("second campaign returns null while leader active", () => {
    const { manager } = setup();
    const election = new LeaderElection("lock", manager, new VirtualClock());
    expect(election.campaign("n1", 100)).toEqual({ token: 1 });
    expect(election.campaign("n2", 100)).toBeNull();
  });

  test("write without leadership throws NotLeaderError", () => {
    const { manager } = setup();
    const election = new LeaderElection("idle", manager, new VirtualClock());
    expect(() => election.write("ghost", 1, "x")).toThrow(NotLeaderError);
    expect(() => election.write("ghost", 99, "x")).toThrow(NotLeaderError);
  });
});
