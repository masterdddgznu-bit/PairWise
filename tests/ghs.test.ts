import {
  VirtualClock,
  GHS,
  defaultEdges,
  buildNeighbors,
  isConnected,
  edgeKey,
  BusyError,
  InvalidConfigError,
} from "../src/index.js";

function make() {
  const clock = new VirtualClock();
  const g = new GHS({ clock });
  return { clock, g };
}

describe("ghs helpers", () => {
  test("default weighted graph", () => {
    const edges = defaultEdges(6);
    expect(edges).toHaveLength(7);
    expect(isConnected(6, edges)).toBe(true);
    expect(buildNeighbors(6, edges)[1].map((x) => x.id)).toEqual([0, 4, 2]);
    expect(edgeKey(2, 1)).toBe("1-2");
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new GHS({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () =>
        new GHS({
          clock,
          processCount: 3,
          edges: [
            { u: 0, v: 1, w: 1 },
            { u: 1, v: 2, w: 1 },
          ],
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new GHS({
          clock,
          processCount: 3,
          edges: [{ u: 0, v: 1, w: 1 }],
        }),
    ).toThrow(InvalidConfigError);
  });
});

describe("ghs mst", () => {
  test("barrier builds unique MST", () => {
    const { g } = make();
    expect(g.barrier()).toBe(15);
    expect(g.done()).toBe(true);
    expect(g.mstEdges().map((e) => e.w)).toEqual([1, 2, 3, 4, 5]);
    expect(g.mstEdges()).toHaveLength(5);
    const frags = new Set([0, 1, 2, 3, 4, 5].map((i) => g.fragmentOf(i)));
    expect(frags.size).toBe(1);
  });

  test("busy begin during find", () => {
    const { g } = make();
    g.begin();
    expect(() => g.begin()).toThrow(BusyError);
    g.pump();
  });

  test("star MST", () => {
    const clock = new VirtualClock();
    const g = new GHS({
      clock,
      processCount: 4,
      edges: [
        { u: 0, v: 1, w: 4 },
        { u: 0, v: 2, w: 1 },
        { u: 0, v: 3, w: 2 },
        { u: 1, v: 2, w: 9 },
        { u: 2, v: 3, w: 8 },
      ],
    });
    expect(g.barrier()).toBe(7);
    expect(g.mstEdges().map((e) => e.w).sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });

  test("path MST is the path itself", () => {
    const clock = new VirtualClock();
    const g = new GHS({
      clock,
      processCount: 4,
      edges: [
        { u: 0, v: 1, w: 3 },
        { u: 1, v: 2, w: 1 },
        { u: 2, v: 3, w: 2 },
      ],
    });
    expect(g.barrier()).toBe(6);
    expect(g.mstEdges()).toHaveLength(3);
  });
});

describe("ghs queries", () => {
  test("neighbors sorted by weight", () => {
    const { g } = make();
    expect(g.neighborsOf(1).map((x) => x.w)).toEqual([1, 2, 3]);
    expect(g.edgeState(0, 1)).toBe("basic");
    g.barrier();
    expect(g.edgeState(0, 1)).toBe("branch");
    expect(g.edgeState(3, 4)).not.toBe("branch");
  });
});
