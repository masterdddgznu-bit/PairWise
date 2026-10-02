import { VirtualClock } from "../src/clock.js";
import { SeqRng } from "../src/rng.js";
import {
  defaultEdges,
  isConnected,
  isSimpleUndirected,
  paletteSizeForRound,
} from "../src/graph.js";
import { BusyError, InvalidConfigError } from "../src/errors.js";
import { Linial } from "../src/linial.js";

function make(
  n = 6,
  rngVals: number[] = [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3],
  edges?: number[][],
): Linial {
  return new Linial({
    clock: new VirtualClock(),
    rng: new SeqRng(rngVals),
    processCount: n,
    edges,
  });
}

describe("linial helpers", () => {
  test("graph utils", () => {
    const e = defaultEdges(5);
    expect(isSimpleUndirected(5, e)).toBe(true);
    expect(isConnected(5, e)).toBe(true);
    expect(paletteSizeForRound(2, 0, 5)).toBe(5);
    expect(paletteSizeForRound(2, 1, 5)).toBe(25);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    const rng = new SeqRng([0]);
    expect(() => new Linial({ clock, rng, processCount: 0 })).toThrow(InvalidConfigError);
    expect(
      () => new Linial({ clock, rng, processCount: 4, edges: [[0, 1], [2, 3]] }),
    ).toThrow(InvalidConfigError);
  });
});

describe("linial coloring", () => {
  test("run yields proper delta+1 coloring on path", () => {
    const m = new Linial({
      clock: new VirtualClock(),
      rng: new SeqRng(Array.from({ length: 64 }, () => 0)),
      processCount: 6,
      maxRounds: 20,
    });
    m.run();
    expect(m.phase()).toBe("done");
    expect(m.isProper()).toBe(true);
    expect(m.maxColor()).toBeLessThanOrEqual(m.delta());
    expect(m.paletteSize()).toBeLessThanOrEqual(m.delta() + 1);
  });

  test("single linialRound advances round index", () => {
    const m = make(5);
    m.start();
    expect(m.roundIndex()).toBe(0);
    const again = m.linialRound();
    expect(m.roundIndex()).toBe(1);
    expect(m.isProper()).toBe(true);
    expect(typeof again).toBe("boolean");
  });

  test("busy rules", () => {
    const m = make();
    expect(() => m.linialRound()).toThrow(BusyError);
    m.start();
    expect(() => m.start()).toThrow(BusyError);
  });

  test("neighbors on path", () => {
    const m = make(4);
    expect(m.neighborsOf(0)).toEqual([1]);
    expect(m.neighborsOf(2)).toEqual([1, 3]);
  });

  test("triangle graph", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];
    const m = make(3, [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2], edges);
    m.run();
    expect(m.isProper()).toBe(true);
    expect(m.maxColor()).toBeLessThanOrEqual(m.delta());
    expect(m.delta()).toBe(2);
  });
});
