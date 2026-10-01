import {
  VirtualClock,
  Dolev,
  BusyError,
  InvalidConfigError,
  makeSig,
  verifyEcho,
} from "../src/index.js";

function make(n = 4, f = 1, sourceId = 0) {
  const clock = new VirtualClock();
  const d = new Dolev({ clock, processCount: n, faultBound: f, sourceId });
  return { clock, d };
}

describe("dolev helpers", () => {
  test("config", () => {
    const { d } = make(4, 1, 0);
    expect(d.processCount()).toBe(4);
    expect(d.faultBound()).toBe(1);
    expect(d.sourceId()).toBe(0);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Dolev({ clock, processCount: 2, faultBound: 1 })).toThrow(InvalidConfigError);
    expect(() => new Dolev({ clock, processCount: 4, sourceId: 9 })).toThrow(InvalidConfigError);
  });

  test("makeSig and verifyEcho", () => {
    const signers = [0];
    const proof = [makeSig(0, "v", 1, signers)];
    expect(
      verifyEcho(
        { kind: "ECHO", round: 1, from: 0, value: "v", signers, proof, msgId: "1" },
        0,
      ),
    ).toBe(true);
    expect(
      verifyEcho(
        { kind: "ECHO", round: 1, from: 0, value: "v", signers, proof: ["bad"], msgId: "1" },
        0,
      ),
    ).toBe(false);
  });
});

describe("dolev broadcast", () => {
  test("honest source all decide same value", () => {
    const { d } = make(4, 1, 0);
    d.start();
    d.broadcast("hello");
    d.pump();
    for (let i = 0; i < 4; i++) {
      expect(d.decided(i)).toBe(true);
      expect(d.decision(i)).toBe("hello");
    }
  });

  test("f=0 single round", () => {
    const { d } = make(3, 0, 1);
    d.start();
    d.broadcast("z");
    d.pump();
    for (let i = 0; i < 3; i++) {
      expect(d.decision(i)).toBe("z");
    }
  });

  test("busy rules", () => {
    const { d } = make();
    expect(() => d.broadcast("x")).toThrow(BusyError);
    d.start();
    expect(() => d.start()).toThrow(BusyError);
    d.broadcast("x");
    expect(() => d.broadcast("y")).toThrow(BusyError);
  });
});
