import { VirtualClock } from "../src/clock.js";
import { SeqRng } from "../src/rng.js";
import {
  defaultEdges,
  isConnected,
  isSimpleUndirected,
  markModulus,
} from "../src/graph.js";
import { BusyError, InvalidConfigError } from "../src/errors.js";
import { AbaRule } from "../src/abarule.js";

function make(
  n = 5,
  rngVals: number[] = Array.from({ length: 64 }, () => 0),
  edges?: number[][],
): AbaRule {
  return new AbaRule({
    clock: new VirtualClock(),
    rng: new SeqRng(rngVals),
    processCount: n,
    edges,
  });
}

describe("abarule helpers", () => {
  test("graph utils", () => {
    const e = defaultEdges(4);
    expect(isSimpleUndirected(4, e)).toBe(true);
    expect(isConnected(4, e)).toBe(true);
    expect(markModulus(0)).toBe(1);
    expect(markModulus(3)).toBe(6);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    const rng = new SeqRng([0]);
    expect(() => new AbaRule({ clock, rng, processCount: 0 })).toThrow(InvalidConfigError);
    expect(
      () => new AbaRule({ clock, rng, processCount: 4, edges: [[0, 1], [2, 3]] }),
    ).toThrow(InvalidConfigError);
  });
});

describe("abarule MIS", () => {
  test("run yields maximal independent set on path", () => {
    const m = make(6);
    m.run();
    expect(m.phase()).toBe("done");
    expect(m.isIndependent()).toBe(true);
    expect(m.isMaximal()).toBe(true);
    expect(m.mis().length).toBeGreaterThan(0);
  });

  test("always-mark rng joins lowest ids carefully", () => {
    // r===0 always marks → lower id wins among adjacent marked
    const m = make(5, Array.from({ length: 80 }, () => 0));
    m.start();
    m.run();
    expect(m.isIndependent()).toBe(true);
    expect(m.isMaximal()).toBe(true);
  });

  test("busy rules", () => {
    const m = make();
    expect(() => m.abiRound()).toThrow(BusyError);
    m.start();
    expect(() => m.start()).toThrow(BusyError);
  });

  test("neighbors on path", () => {
    const m = make(4);
    expect(m.neighborsOf(0)).toEqual([1]);
    expect(m.neighborsOf(2)).toEqual([1, 3]);
  });

  test("triangle", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 0],
    ];
    const m = make(3, Array.from({ length: 40 }, () => 0), edges);
    m.run();
    expect(m.isIndependent()).toBe(true);
    expect(m.isMaximal()).toBe(true);
    expect(m.mis().length).toBe(1);
  });

  test("single vertex", () => {
    const m = new AbaRule({
      clock: new VirtualClock(),
      rng: new SeqRng([0]),
      processCount: 1,
      edges: [],
    });
    m.run();
    expect(m.mis()).toEqual([0]);
    expect(m.isMaximal()).toBe(true);
  });
});
