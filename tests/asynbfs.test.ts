import {
  VirtualClock,
  AsyncBfs,
  defaultEdges,
  buildNeighbors,
  isConnected,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 4, edges?: number[][]) {
  const clock = new VirtualClock();
  const g = new AsyncBfs({ clock, processCount: n, edges });
  return { clock, g };
}

describe("asynbfs helpers", () => {
  test("default graph", () => {
    expect(defaultEdges(4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 3],
    ]);
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
    expect(() => new AsyncBfs({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new AsyncBfs({ clock, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new AsyncBfs({ clock }).distOf(9)).toThrow(InvalidProcessError);
  });
});

describe("asynbfs distances", () => {
  test("ring bfs from 0", () => {
    const { g } = make();
    const sent = g.start(0);
    expect(sent).toBe(2);
    expect(g.converged()).toBe(false);
    g.pump();
    expect(g.converged()).toBe(true);
    expect(g.rootId()).toBe(0);
    expect(g.distOf(0)).toBe(0);
    expect(g.distOf(1)).toBe(1);
    expect(g.distOf(3)).toBe(1);
    expect(g.distOf(2)).toBe(2);
    expect(g.parentOf(0)).toBeNull();
    expect(g.treeEdgeCount()).toBe(3);
    expect(g.childrenOf(0).sort()).toEqual([1, 3]);
    expect(g.inTree(2)).toBe(true);
  });

  test("line graph distances", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    const { g } = make(4, edges);
    g.start(0);
    g.pump();
    expect(g.converged()).toBe(true);
    expect([0, 1, 2, 3].map((i) => g.distOf(i))).toEqual([0, 1, 2, 3]);
    expect(g.parentOf(3)).toBe(2);
    expect(g.childrenOf(1)).toEqual([2]);
  });

  test("busy while in progress", () => {
    const { g } = make();
    g.start(0);
    expect(() => g.start(1)).toThrow(BusyError);
    g.pump();
    g.start(2);
    g.pump();
    expect(g.rootId()).toBe(2);
    expect(g.distOf(2)).toBe(0);
    expect(g.converged()).toBe(true);
  });
});

describe("asynbfs step", () => {
  test("pulse adopts smaller dist", () => {
    const { g } = make(3, [
      [0, 1],
      [1, 2],
    ]);
    g.start(0);
    expect(g.inboxSize(1)).toBe(1);
    expect(g.step(1)).toBe(true);
    expect(g.distOf(1)).toBe(1);
    expect(g.parentOf(1)).toBe(0);
    g.pump();
    expect(g.distOf(2)).toBe(2);
    expect(g.converged()).toBe(true);
  });
});

describe("asynbfs offline", () => {
  test("offline skipped", () => {
    const { g } = make();
    g.setOnline(2, false);
    g.start(0);
    g.pump();
    expect(g.converged()).toBe(true);
    expect(g.inTree(2)).toBe(false);
    expect(g.distOf(1)).toBe(1);
    expect(g.distOf(3)).toBe(1);
    expect(g.treeEdgeCount()).toBe(2);
  });

  test("offline root and step", () => {
    const { g } = make();
    g.setOnline(0, false);
    expect(() => g.start(0)).toThrow(OfflineError);
    g.setOnline(0, true);
    g.setOnline(1, false);
    expect(() => g.step(1)).toThrow(OfflineError);
    expect(g.neighborsOf(0)).toEqual([1, 3]);
  });
});
