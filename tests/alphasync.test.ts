import {
  VirtualClock,
  AlphaSync,
  defaultEdges,
  buildNeighbors,
  isConnected,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 4, edges?: number[][]) {
  const clock = new VirtualClock();
  const a = new AlphaSync({ clock, processCount: n, edges });
  return { clock, a };
}

describe("alphasync helpers", () => {
  test("default graph", () => {
    expect(defaultEdges(4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [0, 3],
    ]);
    expect(isConnected(4, defaultEdges(4))).toBe(true);
    expect(buildNeighbors(4, defaultEdges(4))).toEqual([
      [1, 3],
      [0, 2],
      [1, 3],
      [0, 2],
    ]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new AlphaSync({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new AlphaSync({ clock, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new AlphaSync({ clock }).pulseOf(9)).toThrow(InvalidProcessError);
  });
});

describe("alphasync pulses", () => {
  test("one barrier step to pulse 1", () => {
    const { a } = make();
    expect(a.minPulse()).toBe(0);
    for (let i = 0; i < 4; i++) a.emit(i);
    expect(a.synced()).toBe(false);
    a.pump();
    expect(a.minPulse()).toBe(1);
    expect(a.maxPulse()).toBe(1);
    expect(a.synced()).toBe(true);
  });

  test("barrier to 3", () => {
    const { a } = make();
    expect(a.barrier(3)).toBe(3);
    expect(a.pulseOf(0)).toBe(3);
    expect(a.synced()).toBe(true);
  });

  test("duplicate emit busy", () => {
    const { a } = make();
    a.emit(0);
    expect(() => a.emit(0)).toThrow(BusyError);
    a.reset();
    expect(a.minPulse()).toBe(0);
  });

  test("line graph", () => {
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    const { a } = make(4, edges);
    expect(a.barrier(2)).toBe(2);
    expect(a.synced()).toBe(true);
  });
});

describe("alphasync step", () => {
  test("ignores mismatched pulse but consumes", () => {
    const { a } = make(2, [[0, 1]]);
    a.emit(0);
    a.emit(1);
    a.pump();
    expect(a.pulseOf(0)).toBe(1);
    // emit only 0 for pulse 1; 1 not yet
    a.emit(0);
    expect(a.inboxSize(1)).toBe(1);
    // 1 still at pulse 1? both at 1 after first round. 0 emitted pulse 1 to 1.
    // step 1 receives pulse 1 matching — records. need emit 1 too.
    a.emit(1);
    a.pump();
    expect(a.minPulse()).toBe(2);
  });
});

describe("alphasync offline", () => {
  test("offline neighbor skipped", () => {
    const { a } = make();
    a.setOnline(2, false);
    expect(a.barrier(1)).toBe(1);
    expect(a.pulseOf(0)).toBe(1);
    expect(a.pulseOf(1)).toBe(1);
    expect(a.pulseOf(3)).toBe(1);
    expect(a.pulseOf(2)).toBe(0);
    expect(a.minPulse()).toBe(1);
  });

  test("offline cannot emit/step; setOnline busy while awaiting", () => {
    const { a } = make();
    a.setOnline(1, false);
    expect(() => a.emit(1)).toThrow(OfflineError);
    expect(() => a.step(1)).toThrow(OfflineError);
    a.setOnline(1, true);
    a.emit(0);
    expect(() => a.setOnline(2, false)).toThrow(BusyError);
    expect(a.neighborsOf(0)).toEqual([1, 3]);
  });
});
