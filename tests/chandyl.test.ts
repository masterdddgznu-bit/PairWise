import {
  VirtualClock,
  ChandyL,
  InvalidPayloadError,
  SnapshotInProgressError,
} from "../src/index.js";

function make(n = 3) {
  const clock = new VirtualClock();
  const c = new ChandyL({ clock, processCount: n });
  return { clock, c };
}

describe("chandyl basic", () => {
  test("set and get state", () => {
    const { c } = make();
    c.setState(0, 7);
    expect(c.getState(0)).toBe(7);
  });

  test("empty payload throws", () => {
    const { c } = make();
    expect(() => c.send(0, 1, "")).toThrow(InvalidPayloadError);
  });

  test("initiator alone completes after markers delivered", () => {
    const { c } = make(2);
    c.setState(0, 1);
    c.setState(1, 2);
    c.startSnapshot(0);
    expect(c.processSnapshot(0)).toBe(1);
    expect(c.localDone(0)).toBe(false); // still waiting marker from 1
    c.pump();
    expect(c.localDone(0)).toBe(true);
    expect(c.localDone(1)).toBe(true);
    expect(c.globalDone()).toBe(true);
    expect(c.processSnapshot(1)).toBe(2);
    expect(c.channelSnapshot(0, 1)).toEqual([]);
    expect(c.channelSnapshot(1, 0)).toEqual([]);
  });
});

describe("chandyl in-flight", () => {
  test("message in channel recorded if before marker", () => {
    const { c } = make(2);
    c.setState(0, 10);
    c.setState(1, 20);
    c.send(1, 0, "x");
    c.startSnapshot(0);
    // marker 0→1 queued; channel 1→0 has "x" then will get marker from 1 after 1 starts
    c.pump();
    expect(c.globalDone()).toBe(true);
    // "x" should be in 0's snapshot of channel from 1 (arrived before marker from 1)
    expect(c.channelSnapshot(0, 1)).toEqual(["x"]);
  });

  test("message after marker on edge not recorded", () => {
    const { c } = make(2);
    c.startSnapshot(0);
    // deliver only marker to 1 first
    c.deliver(1);
    expect(c.processSnapshot(1)).toBe(0);
    // 1 has started and sent marker to 0; 1's recording from 0 closed empty
    expect(c.isRecording(1, 0)).toBe(false);
    c.send(0, 1, "late");
    c.pump();
    expect(c.channelSnapshot(1, 0)).toEqual([]);
    expect(c.globalDone()).toBe(true);
  });
});

describe("chandyl three processes", () => {
  test("global snapshot with cross messages", () => {
    const { c } = make(3);
    c.setState(0, 1);
    c.setState(1, 2);
    c.setState(2, 3);
    c.send(1, 2, "a");
    c.send(2, 0, "b");
    c.startSnapshot(0);
    c.pump();
    expect(c.globalDone()).toBe(true);
    expect(c.processSnapshot(0)).toBe(1);
    expect(c.processSnapshot(1)).toBe(2);
    expect(c.processSnapshot(2)).toBe(3);
  });

  test("second snapshot while first incomplete throws", () => {
    const { c } = make(3);
    c.startSnapshot(0);
    expect(() => c.startSnapshot(1)).toThrow(SnapshotInProgressError);
  });

  test("can start again after done", () => {
    const { c } = make(2);
    c.startSnapshot(0);
    c.pump();
    expect(c.globalDone()).toBe(true);
    c.setState(0, 5);
    c.startSnapshot(1);
    c.pump();
    expect(c.processSnapshot(0)).toBe(5);
    expect(c.globalDone()).toBe(true);
  });
});

describe("chandyl deliver order", () => {
  test("deliver picks smallest from id", () => {
    const { c } = make(3);
    c.send(2, 0, "from2");
    c.send(1, 0, "from1");
    expect(c.deliver(0)).toBe(true);
    // recording not started — just consume; queue from1 should be empty first
    expect(c.queueSize(1, 0)).toBe(0);
    expect(c.queueSize(2, 0)).toBe(1);
  });

  test("pump one process", () => {
    const { c } = make(2);
    c.send(1, 0, "a");
    c.send(1, 0, "b");
    c.pump(0);
    expect(c.queueSize(1, 0)).toBe(0);
  });
});

describe("chandyl queueSize", () => {
  test("counts pending", () => {
    const { c } = make(2);
    c.send(0, 1, "a");
    c.send(0, 1, "b");
    expect(c.queueSize(0, 1)).toBe(2);
  });
});
