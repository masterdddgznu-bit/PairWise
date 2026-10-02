import {
  VirtualClock,
  SeqRng,
  IIMatch,
  BusyError,
  InvalidConfigError,
  defaultEdges,
  isConnected,
  isSimpleUndirected,
} from "../src/index.js";

function make(n = 5, vals: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
  const clock = new VirtualClock();
  const rng = new SeqRng(vals);
  const m = new IIMatch({ clock, rng, processCount: n, edges: defaultEdges(n) });
  return { clock, rng, m };
}

describe("iimatch helpers", () => {
  test("graph utils", () => {
    const e = defaultEdges(4);
    expect(isSimpleUndirected(4, e)).toBe(true);
    expect(isConnected(4, e)).toBe(true);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    const rng = new SeqRng([1]);
    expect(() => new IIMatch({ clock, rng, processCount: 0 })).toThrow(InvalidConfigError);
    expect(
      () => new IIMatch({ clock, rng, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
  });
});

describe("iimatch matching", () => {
  test("path yields maximal matching", () => {
    const { m } = make(5, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2]);
    m.start();
    m.run();
    expect(m.isMatching()).toBe(true);
    expect(m.isMaximal()).toBe(true);
    expect(m.matching().length).toBeGreaterThan(0);
  });

  test("single vertex", () => {
    const clock = new VirtualClock();
    const rng = new SeqRng([0]);
    const m = new IIMatch({ clock, rng, processCount: 1, edges: [] });
    m.start();
    m.run();
    expect(m.matching()).toEqual([]);
    expect(m.isMaximal()).toBe(true);
    expect(m.isFree(0)).toBe(true);
  });

  test("busy rules", () => {
    const { m } = make();
    expect(() => m.round()).toThrow(BusyError);
    m.start();
    expect(() => m.start()).toThrow(BusyError);
  });

  test("neighbors on path", () => {
    const { m } = make(4);
    expect(m.neighborsOf(0)).toEqual([1]);
    expect(m.neighborsOf(2)).toEqual([1, 3]);
  });
});
