import {
  VirtualClock,
  DfsTree,
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
  const d = new DfsTree({ clock, processCount: n, edges });
  return { clock, d };
}

describe("dfstree helpers", () => {
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
    expect(() => new DfsTree({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new DfsTree({ clock, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new DfsTree({ clock }).parentOf(9)).toThrow(InvalidProcessError);
  });
});

describe("dfstree tree", () => {
  test("ring spanning tree from 0", () => {
    const { d } = make();
    const sent = d.start(0);
    expect(sent).toBe(1);
    expect(d.converged()).toBe(false);
    d.pump();
    expect(d.converged()).toBe(true);
    expect(d.rootId()).toBe(0);
    expect(d.parentOf(0)).toBeNull();
    expect(d.inTree(0)).toBe(true);
    expect(d.inTree(1)).toBe(true);
    expect(d.inTree(2)).toBe(true);
    expect(d.inTree(3)).toBe(true);
    expect(d.treeEdgeCount()).toBe(3);
    for (let i = 1; i < 4; i++) {
      const p = d.parentOf(i);
      expect(p).not.toBeNull();
      expect(d.childrenOf(p!).includes(i)).toBe(true);
    }
  });

  test("line graph from 0", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    const { d } = make(4, edges);
    d.start(0);
    d.pump();
    expect(d.converged()).toBe(true);
    expect(d.parentOf(1)).toBe(0);
    expect(d.parentOf(2)).toBe(1);
    expect(d.parentOf(3)).toBe(2);
    expect(d.childrenOf(0)).toEqual([1]);
    expect(d.treeEdgeCount()).toBe(3);
  });

  test("busy while in progress", () => {
    const { d } = make();
    d.start(0);
    expect(() => d.start(1)).toThrow(BusyError);
    d.pump();
    d.start(2);
    d.pump();
    expect(d.rootId()).toBe(2);
    expect(d.converged()).toBe(true);
    expect(d.treeEdgeCount()).toBe(3);
  });
});

describe("dfstree step", () => {
  test("first explore sets parent", () => {
    const { d } = make(3, [
      [0, 1],
      [1, 2],
    ]);
    d.start(0);
    expect(d.inboxSize(1)).toBe(1);
    expect(d.step(1)).toBe(true);
    expect(d.parentOf(1)).toBe(0);
    expect(d.inTree(1)).toBe(true);
    d.pump();
    expect(d.converged()).toBe(true);
  });
});

describe("dfstree offline", () => {
  test("offline skipped", () => {
    const { d } = make();
    d.setOnline(2, false);
    d.start(0);
    d.pump();
    expect(d.converged()).toBe(true);
    expect(d.inTree(2)).toBe(false);
    expect(d.inTree(1)).toBe(true);
    expect(d.inTree(3)).toBe(true);
    expect(d.treeEdgeCount()).toBe(2);
  });

  test("offline root and step", () => {
    const { d } = make();
    d.setOnline(0, false);
    expect(() => d.start(0)).toThrow(OfflineError);
    d.setOnline(0, true);
    d.setOnline(1, false);
    expect(() => d.step(1)).toThrow(OfflineError);
    expect(d.neighborsOf(0)).toEqual([1, 3]);
  });
});
