import {
  VirtualClock,
  SeqRng,
  Luby,
  BusyError,
  InvalidConfigError,
  defaultEdges,
  isConnected,
  isSimpleUndirected,
} from "../src/index.js";

function make(n = 5, vals: number[] = [5, 1, 4, 2, 3, 9, 8, 7, 6, 0, 3, 2, 1]) {
  const clock = new VirtualClock();
  const rng = new SeqRng(vals);
  const l = new Luby({ clock, rng, processCount: n, edges: defaultEdges(n) });
  return { clock, rng, l };
}

describe("luby helpers", () => {
  test("graph utils", () => {
    const e = defaultEdges(4);
    expect(isSimpleUndirected(4, e)).toBe(true);
    expect(isConnected(4, e)).toBe(true);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    const rng = new SeqRng([1]);
    expect(() => new Luby({ clock, rng, processCount: 0 })).toThrow(InvalidConfigError);
    expect(
      () => new Luby({ clock, rng, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
  });
});

describe("luby mis", () => {
  test("path becomes independent maximal", () => {
    const { l } = make(5, [10, 1, 9, 2, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    l.start();
    l.run();
    expect(l.isIndependent()).toBe(true);
    expect(l.isMaximal()).toBe(true);
    expect(l.mis().length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      expect(l.isActive(i)).toBe(false);
    }
  });

  test("single vertex", () => {
    const clock = new VirtualClock();
    const rng = new SeqRng([1]);
    const l = new Luby({ clock, rng, processCount: 1, edges: [] });
    l.start();
    l.run();
    expect(l.mis()).toEqual([0]);
    expect(l.isMaximal()).toBe(true);
  });

  test("busy rules", () => {
    const { l } = make();
    expect(() => l.round()).toThrow(BusyError);
    l.start();
    expect(() => l.start()).toThrow(BusyError);
  });

  test("neighbors on path", () => {
    const { l } = make(4);
    expect(l.neighborsOf(0)).toEqual([1]);
    expect(l.neighborsOf(1)).toEqual([0, 2]);
  });
});
