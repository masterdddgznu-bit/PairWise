import { VirtualClock } from "../src/clock.js";
import {
  binSize,
  defaultEdges,
  isConnected,
  isSimpleUndirected,
  nextPaletteBound,
} from "../src/graph.js";
import { BusyError, InvalidConfigError } from "../src/errors.js";
import { KWColor } from "../src/kwcolor.js";

function make(n = 5, edges?: number[][]): KWColor {
  return new KWColor({ clock: new VirtualClock(), processCount: n, edges });
}

function cycle(n: number): number[][] {
  const e: number[][] = [];
  for (let i = 0; i < n; i++) e.push([i, (i + 1) % n]);
  return e;
}

describe("kwcolor helpers", () => {
  test("graph utils and bounds", () => {
    const e = defaultEdges(5);
    expect(isSimpleUndirected(5, e)).toBe(true);
    expect(isConnected(5, e)).toBe(true);
    expect(binSize(2)).toBe(6);
    expect(nextPaletteBound(8, 2)).toBe(6);
    expect(nextPaletteBound(6, 2)).toBe(3);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new KWColor({ clock, processCount: 0 })).toThrow(InvalidConfigError);
    expect(
      () => new KWColor({ clock, processCount: 4, edges: [[0, 1], [2, 3]] }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new KWColor({ clock, processCount: 3, edges: [[0, 1], [1, 0], [1, 2]] }),
    ).toThrow(InvalidConfigError);
  });
});

describe("kwcolor reduction", () => {
  test("path of 8 reduces deterministically", () => {
    const m = make(8);
    m.start();
    expect(m.phase()).toBe("running");
    expect(m.paletteBound()).toBe(8);
    expect(m.reduceRound()).toBe(true);
    expect(m.colors()).toEqual([0, 1, 2, 0, 1, 0, 3, 4]);
    expect(m.paletteBound()).toBe(6);
    expect(m.reduceRound()).toBe(true);
    expect(m.colors()).toEqual([0, 1, 2, 0, 1, 0, 1, 0]);
    expect(m.paletteBound()).toBe(3);
    expect(m.phase()).toBe("done");
    expect(m.reduceRound()).toBe(false);
    expect(m.roundIndex()).toBe(2);
  });

  test("cycle of 13 ends proper within delta+1", () => {
    const m = make(13, cycle(13));
    m.run();
    expect(m.phase()).toBe("done");
    expect(m.isProper()).toBe(true);
    expect(m.maxColor()).toBeLessThanOrEqual(m.delta());
    expect(m.target()).toBe(3);
  });

  test("already small palette is done immediately", () => {
    const k4 = [
      [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
    ];
    const m = make(4, k4);
    m.run();
    expect(m.roundIndex()).toBe(0);
    expect(m.colors()).toEqual([0, 1, 2, 3]);
    expect(m.isProper()).toBe(true);
  });

  test("busy rules and reset", () => {
    const m = make();
    expect(m.phase()).toBe("idle");
    expect(() => m.reduceRound()).toThrow(BusyError);
    m.start();
    expect(() => m.start()).toThrow(BusyError);
    m.run();
    m.reset();
    expect(m.phase()).toBe("idle");
    expect(m.colors()).toEqual([0, 1, 2, 3, 4]);
  });

  test("neighbors and inbox drain", () => {
    const m = make(4);
    expect(m.neighborsOf(2)).toEqual([1, 3]);
    m.start();
    for (let i = 0; i < 4; i++) expect(m.inboxSize(i)).toBe(0);
  });
});
