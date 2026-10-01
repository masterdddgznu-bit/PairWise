import {
  VirtualClock,
  Mattern,
  BusyError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 4) {
  const clock = new VirtualClock();
  const m = new Mattern({ clock, processCount: n });
  return { clock, m };
}

describe("mattern helpers", () => {
  test("ring next", () => {
    const { m } = make(4);
    expect(m.nextOf(0)).toBe(1);
    expect(m.nextOf(3)).toBe(0);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Mattern({ clock, processCount: 1 })).toThrow(InvalidConfigError);
  });
});

describe("mattern termination", () => {
  test("idle system terminates on first probe at initiator", () => {
    const { m } = make(3);
    m.start();
    expect(m.hasProbe(0)).toBe(true);
    let guard = 0;
    while (!m.terminated() && guard < 20) {
      m.pump();
      guard += 1;
    }
    expect(m.terminated()).toBe(true);
  });

  test("basic message then quiet terminates", () => {
    const { m } = make(4);
    m.start();
    m.send(0, 2);
    expect(m.isBlack(0)).toBe(true);
    expect(m.deltaOf(0)).toBe(1);
    m.pump();
    expect(m.isActive(2)).toBe(true);
    expect(m.deltaOf(2)).toBe(-1);
    m.localDone(2);
    let guard = 0;
    while (!m.terminated() && guard < 40) {
      m.pump();
      guard += 1;
    }
    expect(m.terminated()).toBe(true);
    expect(m.deltaOf(0) + m.deltaOf(1) + m.deltaOf(2) + m.deltaOf(3)).toBe(0);
  });

  test("busy rules", () => {
    const { m } = make(3);
    expect(() => m.send(0, 1)).toThrow(BusyError);
    m.start();
    expect(() => m.start()).toThrow(BusyError);
    expect(() => m.send(0, 0)).toThrow(InvalidConfigError);
    expect(() => m.send(0, 9)).toThrow(InvalidProcessError);
    // send from initiator so first PROBE cannot false-terminate
    m.send(0, 2);
    expect(m.step(2)).toBe(true);
    expect(m.isActive(2)).toBe(true);
    // move PROBE past 0 (unsuccessful) → 1 → 2 while 2 still active
    expect(m.step(0)).toBe(true);
    expect(m.step(1)).toBe(true);
    expect(m.hasProbe(2)).toBe(true);
    expect(m.step(2)).toBe(false);
    m.localDone(2);
    expect(m.step(2)).toBe(true);
    expect(() => {
      m.localDone(0);
    }).not.toThrow();
  });
});

describe("mattern clocks", () => {
  test("vector clock and delta adjust on send/receive", () => {
    const { m } = make(3);
    m.start();
    m.send(0, 1);
    expect(m.vectorOf(0)[0]).toBe(1);
    expect(m.deltaOf(0)).toBe(1);
    m.pump();
    expect(m.isActive(1)).toBe(true);
    expect(m.deltaOf(1)).toBe(-1);
    const v1 = m.vectorOf(1);
    expect(v1[0]).toBeGreaterThanOrEqual(1);
    expect(v1[1]).toBeGreaterThanOrEqual(1);
    m.localDone(1);
    expect(m.isActive(1)).toBe(false);
  });
});
