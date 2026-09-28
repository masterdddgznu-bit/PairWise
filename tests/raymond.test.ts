import {
  VirtualClock,
  Raymond,
  defaultEdges,
  buildNeighbors,
  BusyError,
  NotHolderError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 3, edges?: number[][]) {
  const clock = new VirtualClock();
  const r = new Raymond({ clock, processCount: n, edges });
  return { clock, r };
}

describe("raymond helpers", () => {
  test("default edges and neighbors", () => {
    expect(defaultEdges(3)).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(buildNeighbors(3, defaultEdges(3))).toEqual([[1, 2], [0], [0]]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Raymond({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new Raymond({ clock, processCount: 3, edges: [[0, 1]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new Raymond({ clock }).request(9)).toThrow(InvalidProcessError);
  });
});

describe("raymond enter leave", () => {
  test("root enters immediately", () => {
    const { r } = make();
    expect(r.hasToken(0)).toBe(true);
    expect(r.parentOf(1)).toBe(0);
    expect(r.request(0)).toBe("1");
    expect(r.stateOf(0)).toBe("held");
    expect(r.inboxSize(1)).toBe(0);
    r.release(0);
    expect(r.stateOf(0)).toBe("idle");
    expect(r.hasToken(0)).toBe(true);
  });

  test("busy and not holder", () => {
    const { r } = make();
    r.request(0);
    expect(() => r.request(0)).toThrow(BusyError);
    r.release(0);
    expect(() => r.release(0)).toThrow(NotHolderError);
  });
});

describe("raymond token pass", () => {
  test("leaf requests and receives token", () => {
    const { r } = make();
    r.request(1);
    expect(r.stateOf(1)).toBe("waiting");
    expect(r.queueOf(1)).toEqual([1]);
    expect(r.inboxSize(0)).toBe(1);
    r.pump();
    expect(r.stateOf(1)).toBe("held");
    expect(r.hasToken(1)).toBe(true);
    expect(r.hasToken(0)).toBe(false);
    expect(r.parentOf(0)).toBe(1);
    expect(r.holder()).toBe(1);
  });

  test("two leaves: sequential after release", () => {
    const { r } = make();
    r.request(1);
    r.pump();
    expect(r.holder()).toBe(1);
    r.request(2);
    r.pump();
    expect(r.stateOf(2)).toBe("waiting");
    expect(r.holder()).toBe(1);
    r.release(1);
    r.pump();
    expect(r.holder()).toBe(2);
    expect(r.stateOf(2)).toBe("held");
    expect(r.stateOf(1)).toBe("idle");
  });

  test("step forwards request up then token down", () => {
    const { r } = make();
    r.request(2);
    expect(r.step(0)).toBe(true); // REQUEST from 2
    expect(r.hasToken(0)).toBe(false);
    expect(r.inboxSize(2)).toBe(1); // TOKEN
    expect(r.step(2)).toBe(true);
    expect(r.stateOf(2)).toBe("held");
  });
});

describe("raymond exclusion", () => {
  test("only one held", () => {
    const { r } = make();
    r.request(0);
    r.request(1);
    r.pump();
    const held = [0, 1, 2].filter((i) => r.stateOf(i) === "held");
    expect(held).toEqual([0]);
    expect(r.stateOf(1)).toBe("waiting");
    r.release(0);
    r.pump();
    expect(r.stateOf(1)).toBe("held");
  });
});

describe("raymond offline", () => {
  test("offline cannot request or step", () => {
    const { r } = make();
    r.setOnline(2, false);
    expect(() => r.request(2)).toThrow(OfflineError);
    expect(() => r.step(2)).toThrow(OfflineError);
    r.request(1);
    r.pump();
    expect(r.holder()).toBe(1);
  });

  test("online later can request", () => {
    const { r } = make();
    r.setOnline(2, false);
    r.request(0);
    r.release(0);
    r.setOnline(2, true);
    r.request(2);
    r.pump();
    expect(r.holder()).toBe(2);
    expect(r.neighborsOf(0)).toEqual([1, 2]);
  });
});
