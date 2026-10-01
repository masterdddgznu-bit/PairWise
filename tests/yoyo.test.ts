import {
  VirtualClock,
  YoYo,
  defaultEdges,
  defaultUids,
  buildNeighbors,
  isConnected,
  BusyError,
  OfflineError,
  InvalidConfigError,
} from "../src/index.js";

function make() {
  const clock = new VirtualClock();
  const y = new YoYo({ clock });
  return { clock, y };
}

describe("yoyo helpers", () => {
  test("default graph and uids", () => {
    expect(defaultUids(5)).toEqual([10, 30, 20, 50, 40]);
    expect(defaultEdges(5)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 0],
      [1, 3],
    ]);
    expect(isConnected(5, defaultEdges(5))).toBe(true);
    expect(buildNeighbors(5, defaultEdges(5))[1]).toEqual([0, 2, 3]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new YoYo({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new YoYo({ clock, processCount: 3, uids: [1, 1, 2], edges: [[0, 1], [1, 2]] }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new YoYo({
          clock,
          processCount: 3,
          uids: [1, 2, 3],
          edges: [
            [0, 1],
          ],
        }),
    ).toThrow(InvalidConfigError);
  });
});

describe("yoyo election", () => {
  test("sources initially are local maxima", () => {
    const { y } = make();
    // uids 10,30,20,50,40 — sources should include 3 (50) and maybe others
    expect(y.uidOf(3)).toBe(50);
    expect(y.isSource(3)).toBe(true);
    expect(y.sources()).toContain(3);
  });

  test("barrier elects global max uid", () => {
    const { y } = make();
    expect(y.barrier()).toBe(50);
    expect(y.converged()).toBe(true);
    expect(y.leader()).toBe(50);
    expect(y.sources()).toEqual([3]);
  });

  test("busy begin during round", () => {
    const { y } = make();
    y.begin();
    expect(() => y.begin()).toThrow(BusyError);
    y.pump();
  });

  test("line elects endpoint max", () => {
    const clock = new VirtualClock();
    const y = new YoYo({
      clock,
      processCount: 4,
      uids: [4, 3, 2, 1],
      edges: [
        [0, 1],
        [1, 2],
        [2, 3],
      ],
    });
    expect(y.barrier()).toBe(4);
    expect(y.sources()).toEqual([0]);
  });
});

describe("yoyo offline", () => {
  test("offline sink excluded; still elects global max", () => {
    const { y } = make();
    y.setOnline(0, false); // remove sink uid 10
    expect(y.barrier()).toBe(50);
    expect(y.leader()).toBe(50);
    expect(y.isOnline(0)).toBe(false);
  });

  test("offline cannot step; setOnline busy", () => {
    const { y } = make();
    y.setOnline(2, false);
    expect(() => y.step(2)).toThrow(OfflineError);
    y.setOnline(2, true);
    y.begin();
    expect(() => y.setOnline(1, false)).toThrow(BusyError);
  });
});
