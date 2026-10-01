import {
  VirtualClock,
  SignedMsg,
  BusyError,
  InvalidConfigError,
  makeSig,
  verifySm,
  choice,
  DEFAULT_ORDER,
} from "../src/index.js";

function make(n = 4, f = 1, commanderId = 0) {
  const clock = new VirtualClock();
  const s = new SignedMsg({ clock, processCount: n, faultBound: f, commanderId });
  return { clock, s };
}

describe("signedmsg helpers", () => {
  test("config", () => {
    const { s } = make(4, 1, 0);
    expect(s.processCount()).toBe(4);
    expect(s.faultBound()).toBe(1);
    expect(s.commanderId()).toBe(0);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new SignedMsg({ clock, processCount: 2, faultBound: 1 })).toThrow(InvalidConfigError);
    expect(() => new SignedMsg({ clock, processCount: 4, commanderId: 9 })).toThrow(InvalidConfigError);
  });

  test("crypto and choice", () => {
    const signers = [0];
    const proof = [makeSig(0, "attack", signers)];
    expect(
      verifySm({ kind: "SM", value: "attack", signers, proof, from: 0, msgId: "1" }, 0),
    ).toBe(true);
    expect(choice(["retreat", "attack"])).toBe("attack");
    expect(DEFAULT_ORDER).toBe("retreat");
  });
});

describe("signedmsg agreement", () => {
  test("all agree on commander attack", () => {
    const { s } = make(4, 1, 0);
    s.start();
    s.command("attack");
    s.pump();
    for (let i = 0; i < 4; i++) {
      expect(s.decided(i)).toBe(true);
      expect(s.decision(i)).toBe("attack");
      expect(s.valuesOf(i)).toEqual(["attack"]);
    }
  });

  test("f=0 retreat", () => {
    const { s } = make(3, 0, 0);
    s.start();
    s.command("retreat");
    s.pump();
    for (let i = 0; i < 3; i++) {
      expect(s.decision(i)).toBe("retreat");
    }
  });

  test("busy rules", () => {
    const { s } = make();
    expect(() => s.command("attack")).toThrow(BusyError);
    s.start();
    expect(() => s.start()).toThrow(BusyError);
    s.command("attack");
    expect(() => s.command("retreat")).toThrow(BusyError);
  });
});
