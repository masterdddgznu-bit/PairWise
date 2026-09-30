import {
  VirtualClock,
  FloodMax,
  defaultEdges,
  defaultUids,
  buildNeighbors,
  isConnected,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 4, edges?: number[][], uids?: number[]) {
  const clock = new VirtualClock();
  const f = new FloodMax({ clock, processCount: n, edges, uids });
  return { clock, f };
}

describe("floodmax helpers", () => {
  test("default graph", () => {
    expect(defaultEdges(4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 3],
    ]);
    expect(defaultUids(3)).toEqual([0, 1, 2]);
    expect(isConnected(4, defaultEdges(4))).toBe(true);
    expect(buildNeighbors(4, defaultEdges(4))).toEqual([
      [1, 3],
      [0, 2],
      [1, 3],
      [0, 2],
    ]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new FloodMax({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new FloodMax({ clock, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new FloodMax({ clock }).maxOf(9)).toThrow(InvalidProcessError);
  });
});

describe("floodmax election", () => {
  test("flood elects max uid", () => {
    const { f } = make();
    const sent = f.start();
    expect(sent).toBeGreaterThan(0);
    expect(f.converged()).toBe(false);
    f.pump();
    expect(f.converged()).toBe(true);
    expect(f.leaderUid()).toBe(3);
    expect(f.leaderId()).toBe(3);
    expect(f.isLeader(3)).toBe(true);
    expect(f.isLeader(0)).toBe(false);
    expect(f.maxOf(0)).toBe(3);
  });

  test("custom uids", () => {
    const { f } = make(4, undefined, [2, 8, 1, 5]);
    f.start();
    f.pump();
    expect(f.leaderUid()).toBe(8);
    expect(f.leaderId()).toBe(1);
  });

  test("line graph", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    const { f } = make(4, edges, [4, 1, 7, 2]);
    f.start();
    f.pump();
    expect(f.leaderUid()).toBe(7);
    expect(f.leaderId()).toBe(2);
  });

  test("busy while in progress", () => {
    const { f } = make();
    f.start();
    expect(() => f.start()).toThrow(BusyError);
    f.pump();
    f.start();
    f.pump();
    expect(f.leaderUid()).toBe(3);
  });
});

describe("floodmax step", () => {
  test("step updates max and floods", () => {
    const { f } = make(3, [
      [0, 1],
      [1, 2],
    ], [1, 5, 2]);
    f.start();
    // 1's neighbors get floods including value 5
    expect(f.inboxSize(0)).toBeGreaterThan(0);
    f.pump();
    expect(f.maxOf(0)).toBe(5);
    expect(f.maxOf(2)).toBe(5);
  });
});

describe("floodmax offline", () => {
  test("offline skipped at start", () => {
    const { f } = make();
    f.setOnline(3, false);
    f.start();
    f.pump();
    expect(f.leaderUid()).toBe(2);
    expect(f.maxOf(0)).toBe(2);
    expect(f.maxOf(3)).toBe(3); // untouched offline keeps own uid
  });

  test("offline cannot step", () => {
    const { f } = make();
    f.setOnline(1, false);
    expect(() => f.step(1)).toThrow(OfflineError);
    expect(f.neighborsOf(0)).toEqual([1, 3]);
  });
});
