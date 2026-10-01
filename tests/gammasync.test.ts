import {
  VirtualClock,
  GammaSync,
  defaultEdges,
  defaultTreeEdges,
  defaultClusterOf,
  defaultClusterRoots,
  buildNeighbors,
  isConnected,
  isForest,
  orientForest,
  clusterNeighbors,
  BusyError,
  OfflineError,
  InvalidConfigError,
} from "../src/index.js";

function make() {
  const clock = new VirtualClock();
  const g = new GammaSync({ clock });
  return { clock, g };
}

describe("gammasync helpers", () => {
  test("default clustered graph", () => {
    expect(defaultClusterOf(6)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(defaultClusterRoots(6)).toEqual([0, 3]);
    expect(defaultTreeEdges(6)).toEqual([
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
    ]);
    expect(defaultEdges(6)).toEqual([
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
      [2, 3],
    ]);
    expect(isConnected(6, defaultEdges(6))).toBe(true);
    expect(isForest(6, defaultTreeEdges(6))).toBe(true);
    const o = orientForest(6, defaultTreeEdges(6), defaultClusterOf(6), defaultClusterRoots(6));
    expect(o.parent).toEqual([null, 0, 1, null, 3, 4]);
    expect(o.children[0]).toEqual([1]);
    expect(o.children[3]).toEqual([4]);
    expect(clusterNeighbors(0, 6, defaultEdges(6), defaultClusterOf(6))).toEqual([1]);
    expect(clusterNeighbors(1, 6, defaultEdges(6), defaultClusterOf(6))).toEqual([0]);
    expect(buildNeighbors(6, defaultEdges(6))[2]).toEqual([1, 3]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new GammaSync({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () =>
        new GammaSync({
          clock,
          processCount: 4,
          edges: [
            [0, 1],
            [2, 3],
          ],
          treeEdges: [
            [0, 1],
            [2, 3],
          ],
          clusterOf: [0, 0, 1, 1],
          clusterRoots: [0, 2],
        }),
    ).toThrow(InvalidConfigError); // disconnected graph
  });
});

describe("gammasync pulses", () => {
  test("one round to pulse 1", () => {
    const { g } = make();
    expect(g.begin()).toBeGreaterThan(0);
    g.pump();
    expect(g.minPulse()).toBe(1);
    expect(g.maxPulse()).toBe(1);
    expect(g.synced()).toBe(true);
    expect(g.leaderNeighbors(0)).toEqual([3]);
    expect(g.leaderNeighbors(3)).toEqual([0]);
  });

  test("barrier to 3", () => {
    const { g } = make();
    expect(g.barrier(3)).toBe(3);
    expect(g.synced()).toBe(true);
    for (let i = 0; i < 6; i++) expect(g.pulseOf(i)).toBe(3);
  });

  test("busy begin while up in flight", () => {
    const { g } = make();
    g.begin();
    expect(() => g.begin()).toThrow(BusyError);
    g.pump();
    expect(g.synced()).toBe(true);
  });

  test("single cluster degenerates to beta", () => {
    const clock = new VirtualClock();
    const g = new GammaSync({
      clock,
      processCount: 4,
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
      treeEdges: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
      clusterOf: [0, 0, 0, 0],
      clusterRoots: [0],
    });
    expect(g.leaderNeighbors(0)).toEqual([]);
    g.begin();
    g.pump();
    expect(g.minPulse()).toBe(1);
    expect(g.synced()).toBe(true);
  });
});

describe("gammasync step", () => {
  test("up from leaf then alpha between roots", () => {
    const { g } = make();
    // leaves: 2 and 5
    expect(g.childrenOf(1)).toEqual([2]);
    expect(g.parentOf(2)).toBe(1);
    const n = g.begin();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(g.inboxSize(1)).toBeGreaterThan(0);
    g.pump();
    expect(g.pulseOf(0)).toBe(1);
    expect(g.pulseOf(5)).toBe(1);
  });
});

describe("gammasync offline", () => {
  test("offline leaf still advances", () => {
    const { g } = make();
    g.setOnline(5, false);
    expect(g.barrier(1)).toBe(1);
    expect(g.pulseOf(0)).toBe(1);
    expect(g.pulseOf(3)).toBe(1);
    expect(g.pulseOf(4)).toBe(1);
    expect(g.pulseOf(5)).toBe(0);
    expect(g.minPulse()).toBe(1);
  });

  test("offline cannot step; setOnline busy", () => {
    const { g } = make();
    g.setOnline(2, false);
    expect(() => g.step(2)).toThrow(OfflineError);
    g.setOnline(2, true);
    g.begin();
    expect(() => g.setOnline(4, false)).toThrow(BusyError);
    expect(g.clusterOf(4)).toBe(1);
    expect(g.clusterRoot(1)).toBe(3);
  });
});
