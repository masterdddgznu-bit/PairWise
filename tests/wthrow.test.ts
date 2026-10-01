import {
  VirtualClock,
  WThrow,
  defaultEdges,
  buildNeighbors,
  isConnected,
  isPowerOfTwo,
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make() {
  const clock = new VirtualClock();
  const w = new WThrow({ clock });
  return { clock, w };
}

describe("wthrow helpers", () => {
  test("default line and powers", () => {
    expect(isPowerOfTwo(64)).toBe(true);
    expect(isPowerOfTwo(3)).toBe(false);
    expect(defaultEdges(5)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(isConnected(5, defaultEdges(5))).toBe(true);
    expect(buildNeighbors(5, defaultEdges(5))[1]).toEqual([0, 2]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new WThrow({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(() => new WThrow({ clock, totalWeight: 3 })).toThrow(InvalidConfigError);
    expect(
      () => new WThrow({ clock, processCount: 3, edges: [[0, 1]], rootId: 0 }),
    ).toThrow(InvalidConfigError);
  });
});

describe("wthrow diffusion", () => {
  test("line wave returns all weight", () => {
    const { w } = make();
    w.start();
    expect(w.weightOf(0)).toBe(64);
    w.send(0, 1);
    expect(w.weightOf(0)).toBe(32);
    w.pump();
    expect(w.weightOf(1)).toBe(32);
    w.send(1, 2);
    w.pump();
    w.send(2, 3);
    w.pump();
    w.send(3, 4);
    w.pump();
    expect(w.isActive(4)).toBe(true);
    for (const id of [4, 3, 2, 1]) {
      w.localDone(id);
      w.pump();
    }
    expect(w.weightOf(0)).toBe(64);
    w.localDone(0);
    expect(w.terminated()).toBe(true);
  });

  test("split and conserve", () => {
    const clock = new VirtualClock();
    const w = new WThrow({
      clock,
      processCount: 3,
      edges: [
        [0, 1],
        [0, 2],
      ],
      totalWeight: 16,
    });
    w.start();
    w.send(0, 1);
    w.send(0, 2);
    w.pump();
    expect(w.weightOf(0) + w.weightOf(1) + w.weightOf(2)).toBe(16);
    w.localDone(1);
    w.localDone(2);
    w.pump();
    expect(w.weightOf(0)).toBe(16);
    w.localDone(0);
    expect(w.terminated()).toBe(true);
  });

  test("busy and weight rules", () => {
    const { w } = make();
    expect(() => w.send(0, 1)).toThrow(BusyError);
    w.start();
    expect(() => w.start()).toThrow(BusyError);
    expect(() => w.send(0, 99)).toThrow(InvalidProcessError);
    expect(() => w.send(0, 2)).toThrow(InvalidConfigError);
    // drain to weight 1 then cannot send
    let guard = 0;
    while (w.weightOf(0) >= 2 && guard < 20) {
      w.send(0, 1);
      guard += 1;
    }
    w.pump();
    expect(w.weightOf(0)).toBe(1);
    expect(() => w.send(0, 1)).toThrow(InvalidConfigError);
  });
});

describe("wthrow star", () => {
  test("root fans out then terminates", () => {
    const clock = new VirtualClock();
    const w = new WThrow({
      clock,
      processCount: 4,
      edges: [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
      totalWeight: 32,
    });
    w.start();
    w.send(0, 1);
    w.send(0, 2);
    w.send(0, 3);
    w.pump();
    for (const id of [1, 2, 3]) w.localDone(id);
    w.pump();
    expect(w.weightOf(0)).toBe(32);
    w.localDone(0);
    expect(w.terminated()).toBe(true);
  });
});
