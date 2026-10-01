import {
  VirtualClock,
  SeqRng,
  BenOr,
  BusyError,
  InvalidConfigError,
} from "../src/index.js";

function make(n = 6, f = 1, bits: Array<0 | 1> = [0, 1, 0, 1, 0, 1]) {
  const clock = new VirtualClock();
  const rng = new SeqRng(bits);
  const b = new BenOr({ clock, rng, processCount: n, faultBound: f });
  return { clock, rng, b };
}

describe("benor helpers", () => {
  test("config", () => {
    const { b } = make();
    expect(b.processCount()).toBe(6);
    expect(b.faultBound()).toBe(1);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    const rng = new SeqRng([0]);
    expect(() => new BenOr({ clock, rng, processCount: 1 })).toThrow(InvalidConfigError);
    expect(() => new BenOr({ clock, rng, processCount: 5, faultBound: 1 })).toThrow(InvalidConfigError);
  });
});

describe("benor agreement", () => {
  test("all-zero decides 0", () => {
    const { b } = make(6, 1, [1, 1, 1, 1]);
    b.start([0, 0, 0, 0, 0, 0]);
    b.pump();
    for (let i = 0; i < 6; i++) {
      expect(b.decided(i)).toBe(true);
      expect(b.decision(i)).toBe(0);
    }
  });

  test("all-one decides 1", () => {
    const { b } = make(6, 1, [0, 0, 0, 0]);
    b.start([1, 1, 1, 1, 1, 1]);
    b.pump();
    for (let i = 0; i < 6; i++) {
      expect(b.decision(i)).toBe(1);
    }
  });

  test("mixed inputs eventually agree with fixed rng", () => {
    const { b } = make(6, 1, [0, 0, 0, 0, 0, 0, 0, 0]);
    b.start([0, 1, 0, 1, 0, 1]);
    b.pump();
    const d0 = b.decision(0);
    expect(d0).not.toBeNull();
    for (let i = 0; i < 6; i++) {
      expect(b.decided(i)).toBe(true);
      expect(b.decision(i)).toBe(d0);
    }
  });

  test("busy and bad start", () => {
    const { b } = make();
    expect(() => b.start([0, 1])).toThrow(InvalidConfigError);
    b.start([0, 0, 0, 0, 0, 0]);
    expect(() => b.start([1, 1, 1, 1, 1, 1])).toThrow(BusyError);
  });
});
