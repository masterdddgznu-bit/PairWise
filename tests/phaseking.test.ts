import {
  VirtualClock,
  PhaseKing,
  BusyError,
  InvalidConfigError,
} from "../src/index.js";

function make(n = 4, f = 1) {
  const clock = new VirtualClock();
  const pk = new PhaseKing({ clock, processCount: n, faultBound: f });
  return { clock, pk };
}

describe("phaseking helpers", () => {
  test("config and king", () => {
    const { pk } = make(4, 1);
    expect(pk.processCount()).toBe(4);
    expect(pk.faultBound()).toBe(1);
    expect(pk.kingOf(0)).toBe(0);
    expect(pk.kingOf(1)).toBe(1);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new PhaseKing({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(() => new PhaseKing({ clock, processCount: 4, faultBound: 2 })).toThrow(InvalidConfigError);
  });
});

describe("phaseking agreement", () => {
  test("all-zero inputs decide 0", () => {
    const { pk } = make(4, 1);
    pk.start([0, 0, 0, 0]);
    pk.pump();
    for (let i = 0; i < 4; i++) {
      expect(pk.decided(i)).toBe(true);
      expect(pk.decision(i)).toBe(0);
    }
  });

  test("all-one inputs decide 1", () => {
    const { pk } = make(4, 1);
    pk.start([1, 1, 1, 1]);
    pk.pump();
    for (let i = 0; i < 4; i++) {
      expect(pk.decision(i)).toBe(1);
    }
  });

  test("mixed inputs still agree", () => {
    const { pk } = make(4, 1);
    pk.start([0, 1, 0, 1]);
    pk.pump();
    const d0 = pk.decision(0);
    expect(d0).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      expect(pk.decided(i)).toBe(true);
      expect(pk.decision(i)).toBe(d0);
    }
  });

  test("busy and bad start", () => {
    const { pk } = make(4, 1);
    expect(() => pk.start([0, 1])).toThrow(InvalidConfigError);
    pk.start([0, 0, 1, 1]);
    expect(() => pk.start([0, 0, 0, 0])).toThrow(BusyError);
  });
});
