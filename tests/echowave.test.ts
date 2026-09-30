import {
  VirtualClock,
  EchoWave,
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
  const e = new EchoWave({ clock, processCount: n, edges });
  return { clock, e };
}

describe("echowave helpers", () => {
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
    expect(() => new EchoWave({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new EchoWave({ clock, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new EchoWave({ clock }).parentOf(9)).toThrow(InvalidProcessError);
  });
});

describe("echowave tree", () => {
  test("ring elects spanning tree from root 0", () => {
    const { e } = make();
    const sent = e.start(0);
    expect(sent).toBe(2);
    expect(e.converged()).toBe(false);
    e.pump();
    expect(e.converged()).toBe(true);
    expect(e.rootId()).toBe(0);
    expect(e.parentOf(0)).toBeNull();
    expect(e.inTree(0)).toBe(true);
    expect(e.inTree(1)).toBe(true);
    expect(e.inTree(2)).toBe(true);
    expect(e.inTree(3)).toBe(true);
    expect(e.treeEdgeCount()).toBe(3);
    // every non-root online node has a parent in tree
    for (let i = 1; i < 4; i++) {
      const p = e.parentOf(i);
      expect(p).not.toBeNull();
      expect(e.childrenOf(p!).includes(i)).toBe(true);
    }
  });

  test("line graph from end", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    const { e } = make(4, edges);
    e.start(0);
    e.pump();
    expect(e.converged()).toBe(true);
    expect(e.parentOf(1)).toBe(0);
    expect(e.parentOf(2)).toBe(1);
    expect(e.parentOf(3)).toBe(2);
    expect(e.childrenOf(0)).toEqual([1]);
    expect(e.treeEdgeCount()).toBe(3);
  });

  test("busy while in progress", () => {
    const { e } = make();
    e.start(0);
    expect(() => e.start(1)).toThrow(BusyError);
    e.pump();
    e.start(2);
    e.pump();
    expect(e.rootId()).toBe(2);
    expect(e.converged()).toBe(true);
    expect(e.treeEdgeCount()).toBe(3);
  });
});

describe("echowave step", () => {
  test("first explore sets parent", () => {
    const { e } = make(3, [
      [0, 1],
      [1, 2],
    ]);
    e.start(0);
    expect(e.inboxSize(1)).toBe(1);
    expect(e.step(1)).toBe(true);
    expect(e.parentOf(1)).toBe(0);
    expect(e.inTree(1)).toBe(true);
    e.pump();
    expect(e.converged()).toBe(true);
  });
});

describe("echowave offline", () => {
  test("offline skipped", () => {
    const { e } = make();
    e.setOnline(2, false);
    e.start(0);
    e.pump();
    expect(e.converged()).toBe(true);
    expect(e.inTree(2)).toBe(false);
    expect(e.inTree(1)).toBe(true);
    expect(e.inTree(3)).toBe(true);
    // online visited nodes form tree: edges = online_visited - 1
    expect(e.treeEdgeCount()).toBe(2);
  });

  test("offline root and step", () => {
    const { e } = make();
    e.setOnline(0, false);
    expect(() => e.start(0)).toThrow(OfflineError);
    e.setOnline(0, true);
    e.setOnline(1, false);
    expect(() => e.step(1)).toThrow(OfflineError);
    expect(e.neighborsOf(0)).toEqual([1, 3]);
  });
});
