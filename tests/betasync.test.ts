import {
  VirtualClock,
  BetaSync,
  defaultEdges,
  buildNeighbors,
  isConnected,
  isTree,
  orientTree,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 4, edges?: number[][], rootId = 0) {
  const clock = new VirtualClock();
  const b = new BetaSync({ clock, processCount: n, edges, rootId });
  return { clock, b };
}

describe("betasync helpers", () => {
  test("default tree", () => {
    expect(defaultEdges(4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(isTree(4, defaultEdges(4))).toBe(true);
    expect(isConnected(4, defaultEdges(4))).toBe(true);
    expect(buildNeighbors(4, defaultEdges(4))).toEqual([
      [1],
      [0, 2],
      [1, 3],
      [2],
    ]);
    const o = orientTree(4, defaultEdges(4), 0);
    expect(o.parent).toEqual([null, 0, 1, 2]);
    expect(o.children[0]).toEqual([1]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new BetaSync({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () =>
        new BetaSync({
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
    expect(() => new BetaSync({ clock }).pulseOf(9)).toThrow(InvalidProcessError);
  });
});

describe("betasync pulses", () => {
  test("one round to pulse 1", () => {
    const { b } = make();
    expect(b.minPulse()).toBe(0);
    const sent = b.begin();
    expect(sent).toBeGreaterThan(0);
    b.pump();
    expect(b.minPulse()).toBe(1);
    expect(b.maxPulse()).toBe(1);
    expect(b.synced()).toBe(true);
  });

  test("barrier to 3", () => {
    const { b } = make();
    expect(b.barrier(3)).toBe(3);
    expect(b.pulseOf(0)).toBe(3);
    expect(b.synced()).toBe(true);
  });

  test("busy begin while up in flight", () => {
    const { b } = make();
    b.begin();
    expect(() => b.begin()).toThrow(BusyError);
    b.pump();
    b.reset();
    expect(b.minPulse()).toBe(0);
  });

  test("star from center root", () => {
    const edges = [
      [0, 1],
      [0, 2],
      [0, 3],
    ];
    const { b } = make(4, edges, 0);
    expect(b.childrenOf(0)).toEqual([1, 2, 3]);
    expect(b.barrier(2)).toBe(2);
    expect(b.synced()).toBe(true);
  });
});

describe("betasync step", () => {
  test("up from leaf", () => {
    const { b } = make(3, [
      [0, 1],
      [1, 2],
    ], 0);
    b.begin();
    expect(b.inboxSize(1)).toBeGreaterThan(0);
    b.pump();
    expect(b.pulseOf(2)).toBe(1);
    expect(b.pulseOf(0)).toBe(1);
  });
});

describe("betasync offline", () => {
  test("offline leaf still advances", () => {
    const { b } = make();
    b.setOnline(3, false);
    expect(b.barrier(1)).toBe(1);
    expect(b.pulseOf(0)).toBe(1);
    expect(b.pulseOf(2)).toBe(1);
    expect(b.pulseOf(3)).toBe(0);
    expect(b.minPulse()).toBe(1);
  });

  test("offline cannot step; setOnline busy", () => {
    const { b } = make();
    b.setOnline(1, false);
    expect(() => b.step(1)).toThrow(OfflineError);
    b.setOnline(1, true);
    b.begin();
    expect(() => b.setOnline(2, false)).toThrow(BusyError);
    expect(b.parentOf(1)).toBe(0);
  });
});
