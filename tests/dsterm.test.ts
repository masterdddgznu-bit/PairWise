import {
  VirtualClock,
  DSTerm,
  defaultEdges,
  buildNeighbors,
  isConnected,
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make() {
  const clock = new VirtualClock();
  const d = new DSTerm({ clock });
  return { clock, d };
}

describe("dsterm helpers", () => {
  test("default line", () => {
    expect(defaultEdges(5)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
    expect(isConnected(5, defaultEdges(5))).toBe(true);
    expect(buildNeighbors(5, defaultEdges(5))[2]).toEqual([1, 3]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new DSTerm({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new DSTerm({ clock, processCount: 3, edges: [[0, 1]], rootId: 0 }),
    ).toThrow(InvalidConfigError);
    expect(() => new DSTerm({ clock, processCount: 3, edges: [[0, 1], [1, 2]], rootId: 9 })).toThrow(
      InvalidConfigError,
    );
  });
});

describe("dsterm diffusion", () => {
  test("line wave terminates at root", () => {
    const { d } = make();
    d.start();
    expect(d.isEngaged(0)).toBe(true);
    d.send(0, 1);
    d.pump();
    expect(d.isEngaged(1)).toBe(true);
    expect(d.parentOf(1)).toBe(0);
    d.send(1, 2);
    d.pump();
    d.send(2, 3);
    d.pump();
    d.send(3, 4);
    d.pump();
    expect(d.isEngaged(4)).toBe(true);
    // finish from leaves up
    for (const id of [4, 3, 2, 1, 0]) {
      d.localDone(id);
      d.pump();
    }
    expect(d.terminated()).toBe(true);
    expect(d.isEngaged(1)).toBe(false);
  });

  test("redundant msg acks immediately", () => {
    const clock = new VirtualClock();
    const d = new DSTerm({
      clock,
      processCount: 3,
      edges: [
        [0, 1],
        [1, 2],
        [0, 2],
      ],
      rootId: 0,
    });
    d.start();
    d.send(0, 1);
    d.pump();
    d.send(0, 2);
    d.pump();
    // 1 also sends to 2 who is already engaged → immediate ACK
    d.send(1, 2);
    d.pump();
    expect(d.deficitOf(1)).toBe(0);
    d.localDone(2);
    d.localDone(1);
    d.localDone(0);
    d.pump();
    expect(d.terminated()).toBe(true);
  });

  test("busy rules", () => {
    const { d } = make();
    expect(() => d.send(0, 1)).toThrow(BusyError);
    d.start();
    expect(() => d.start()).toThrow(BusyError);
    expect(() => d.localDone(2)).toThrow(BusyError);
    expect(() => d.send(0, 99)).toThrow(InvalidProcessError);
    expect(() => d.send(0, 2)).toThrow(InvalidConfigError);
  });
});

describe("dsterm star", () => {
  test("root fans out then terminates", () => {
    const clock = new VirtualClock();
    const d = new DSTerm({
      clock,
      processCount: 4,
      edges: [
        [0, 1],
        [0, 2],
        [0, 3],
      ],
      rootId: 0,
    });
    d.start();
    d.send(0, 1);
    d.send(0, 2);
    d.send(0, 3);
    expect(d.deficitOf(0)).toBe(3);
    d.pump();
    for (const id of [1, 2, 3]) {
      expect(d.parentOf(id)).toBe(0);
      d.localDone(id);
    }
    d.pump();
    expect(d.deficitOf(0)).toBe(0);
    d.localDone(0);
    expect(d.terminated()).toBe(true);
  });
});
