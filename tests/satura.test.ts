import {
  VirtualClock,
  Satura,
  defaultEdges,
  defaultUids,
  buildNeighbors,
  isConnected,
  isTree,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 4, edges?: number[][], uids?: number[]) {
  const clock = new VirtualClock();
  const s = new Satura({ clock, processCount: n, edges, uids });
  return { clock, s };
}

describe("satura helpers", () => {
  test("default tree", () => {
    expect(defaultEdges(4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(defaultUids(3)).toEqual([0, 1, 2]);
    expect(isTree(4, defaultEdges(4))).toBe(true);
    expect(isConnected(4, defaultEdges(4))).toBe(true);
    expect(buildNeighbors(4, defaultEdges(4))).toEqual([
      [1],
      [0, 2],
      [1, 3],
      [2],
    ]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Satura({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () =>
        new Satura({
          clock,
          processCount: 4,
          edges: [
            [0, 1],
            [1, 2],
            [2, 3],
            [0, 3],
          ],
        }),
    ).toThrow(InvalidConfigError);
    expect(() => new Satura({ clock }).knownOf(9)).toThrow(InvalidProcessError);
  });
});

describe("satura election", () => {
  test("line elects max uid", () => {
    const { s } = make();
    const sent = s.start();
    expect(sent).toBe(2);
    expect(s.converged()).toBe(false);
    s.pump();
    expect(s.converged()).toBe(true);
    expect(s.leaderUid()).toBe(3);
    expect(s.leaderId()).toBe(3);
    expect(s.isLeader(3)).toBe(true);
    expect(s.knownOf(0)).toBe(3);
    expect(s.knownOf(2)).toBe(3);
  });

  test("custom uids", () => {
    const { s } = make(4, undefined, [2, 8, 1, 5]);
    s.start();
    s.pump();
    expect(s.leaderUid()).toBe(8);
    expect(s.leaderId()).toBe(1);
  });

  test("star tree", () => {
    const edges = [
      [0, 1],
      [0, 2],
      [0, 3],
    ];
    const { s } = make(4, edges, [4, 1, 7, 2]);
    s.start();
    s.pump();
    expect(s.leaderUid()).toBe(7);
    expect(s.leaderId()).toBe(2);
  });

  test("busy while in progress", () => {
    const { s } = make();
    s.start();
    expect(() => s.start()).toThrow(BusyError);
    s.pump();
    s.start();
    s.pump();
    expect(s.leaderUid()).toBe(3);
  });
});

describe("satura step", () => {
  test("leaf pulse starts saturation", () => {
    const { s } = make(3, [
      [0, 1],
      [1, 2],
    ], [1, 5, 2]);
    s.start();
    expect(s.inboxSize(1)).toBeGreaterThan(0);
    s.pump();
    expect(s.leaderUid()).toBe(5);
  });
});

describe("satura offline", () => {
  test("offline leaf removed still tree", () => {
    const { s } = make();
    s.setOnline(3, false);
    s.start();
    s.pump();
    expect(s.converged()).toBe(true);
    expect(s.leaderUid()).toBe(2);
    expect(s.knownOf(3)).toBeNull();
  });

  test("offline cannot step; setOnline busy", () => {
    const { s } = make();
    s.setOnline(1, false);
    expect(() => s.step(1)).toThrow(OfflineError);
    s.setOnline(1, true);
    s.start();
    expect(() => s.setOnline(2, false)).toThrow(BusyError);
    expect(s.neighborsOf(0)).toEqual([1]);
  });
});
