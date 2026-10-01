import {
  VirtualClock,
  OralMsg,
  BusyError,
  InvalidConfigError,
  majority,
  DEFAULT_ORDER,
} from "../src/index.js";

function make(n = 4, f = 1, commanderId = 0) {
  const clock = new VirtualClock();
  const o = new OralMsg({ clock, processCount: n, faultBound: f, commanderId });
  return { clock, o };
}

describe("oralmsg helpers", () => {
  test("config", () => {
    const { o } = make(4, 1, 0);
    expect(o.processCount()).toBe(4);
    expect(o.faultBound()).toBe(1);
    expect(o.commanderId()).toBe(0);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new OralMsg({ clock, processCount: 4, faultBound: 2 })).toThrow(InvalidConfigError);
    expect(() => new OralMsg({ clock, processCount: 4, commanderId: 9 })).toThrow(InvalidConfigError);
  });

  test("majority tie breaks lexicographically", () => {
    expect(majority(["attack", "retreat"])).toBe("attack");
    expect(majority(["retreat", "retreat", "attack"])).toBe("retreat");
    expect(DEFAULT_ORDER).toBe("retreat");
  });
});

describe("oralmsg agreement", () => {
  test("all lieutenants agree with commander attack", () => {
    const { o } = make(4, 1, 0);
    o.start();
    o.command("attack");
    o.pump();
    expect(o.decision(0)).toBe("attack");
    for (let i = 1; i < 4; i++) {
      expect(o.decided(i)).toBe(true);
      expect(o.decision(i)).toBe("attack");
    }
  });

  test("f=0 commander retreat", () => {
    const { o } = make(3, 0, 0);
    o.start();
    o.command("retreat");
    o.pump();
    for (let i = 0; i < 3; i++) {
      expect(o.decision(i)).toBe("retreat");
    }
  });

  test("busy rules", () => {
    const { o } = make();
    expect(() => o.command("attack")).toThrow(BusyError);
    o.start();
    expect(() => o.start()).toThrow(BusyError);
    o.command("attack");
    expect(() => o.command("retreat")).toThrow(BusyError);
  });
});
