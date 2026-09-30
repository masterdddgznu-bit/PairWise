import {
  VirtualClock,
  Tarry,
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
  const t = new Tarry({ clock, processCount: n, edges });
  return { clock, t };
}

describe("tarry helpers", () => {
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
    expect(() => new Tarry({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new Tarry({ clock, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new Tarry({ clock }).parentOf(9)).toThrow(InvalidProcessError);
  });
});

describe("tarry tree", () => {
  test("ring spanning tree from 0", () => {
    const { t } = make();
    const sent = t.start(0);
    expect(sent).toBe(1);
    expect(t.converged()).toBe(false);
    t.pump();
    expect(t.converged()).toBe(true);
    expect(t.rootId()).toBe(0);
    expect(t.parentOf(0)).toBeNull();
    expect(t.inTree(0)).toBe(true);
    expect(t.inTree(1)).toBe(true);
    expect(t.inTree(2)).toBe(true);
    expect(t.inTree(3)).toBe(true);
    expect(t.treeEdgeCount()).toBe(3);
    for (let i = 1; i < 4; i++) {
      const p = t.parentOf(i);
      expect(p).not.toBeNull();
      expect(t.childrenOf(p!).includes(i)).toBe(true);
    }
  });

  test("line graph from 0", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    const { t } = make(4, edges);
    t.start(0);
    t.pump();
    expect(t.converged()).toBe(true);
    expect(t.parentOf(1)).toBe(0);
    expect(t.parentOf(2)).toBe(1);
    expect(t.parentOf(3)).toBe(2);
    expect(t.childrenOf(0)).toEqual([1]);
    expect(t.treeEdgeCount()).toBe(3);
  });

  test("busy while in progress", () => {
    const { t } = make();
    t.start(0);
    expect(() => t.start(1)).toThrow(BusyError);
    t.pump();
    t.start(2);
    t.pump();
    expect(t.rootId()).toBe(2);
    expect(t.converged()).toBe(true);
    expect(t.treeEdgeCount()).toBe(3);
  });
});

describe("tarry step", () => {
  test("first token sets parent", () => {
    const { t } = make(3, [
      [0, 1],
      [1, 2],
    ]);
    t.start(0);
    expect(t.inboxSize(1)).toBe(1);
    expect(t.step(1)).toBe(true);
    expect(t.parentOf(1)).toBe(0);
    expect(t.inTree(1)).toBe(true);
    t.pump();
    expect(t.converged()).toBe(true);
  });
});

describe("tarry offline", () => {
  test("offline skipped", () => {
    const { t } = make();
    t.setOnline(2, false);
    t.start(0);
    t.pump();
    expect(t.converged()).toBe(true);
    expect(t.inTree(2)).toBe(false);
    expect(t.inTree(1)).toBe(true);
    expect(t.inTree(3)).toBe(true);
    expect(t.treeEdgeCount()).toBe(2);
  });

  test("offline root and step", () => {
    const { t } = make();
    t.setOnline(0, false);
    expect(() => t.start(0)).toThrow(OfflineError);
    t.setOnline(0, true);
    t.setOnline(1, false);
    expect(() => t.step(1)).toThrow(OfflineError);
    expect(t.neighborsOf(0)).toEqual([1, 3]);
  });
});
