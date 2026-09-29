import {
  VirtualClock,
  Naimi,
  BusyError,
  NotHolderError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 3) {
  const clock = new VirtualClock();
  const m = new Naimi({ clock, processCount: n });
  return { clock, m };
}

describe("naimi init", () => {
  test("process 0 starts with token", () => {
    const { m } = make();
    expect(m.hasToken(0)).toBe(true);
    expect(m.hasToken(1)).toBe(false);
    expect(m.lastOf(1)).toBe(0);
    expect(m.lastOf(0)).toBe(0);
    expect(m.holder()).toBe(0);
    expect(m.nextOf(0)).toBeNull();
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Naimi({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(() => new Naimi({ clock }).request(9)).toThrow(InvalidProcessError);
  });
});

describe("naimi enter leave", () => {
  test("holder enters immediately", () => {
    const { m } = make();
    expect(m.request(0)).toBe("1");
    expect(m.stateOf(0)).toBe("held");
    expect(m.inboxSize(1)).toBe(0);
    m.release(0);
    expect(m.stateOf(0)).toBe("idle");
    expect(m.hasToken(0)).toBe(true);
  });

  test("busy and not holder", () => {
    const { m } = make();
    m.request(0);
    expect(() => m.request(0)).toThrow(BusyError);
    m.release(0);
    expect(() => m.release(0)).toThrow(NotHolderError);
  });
});

describe("naimi token pass", () => {
  test("non-holder gets token via request", () => {
    const { m } = make();
    m.request(1);
    expect(m.stateOf(1)).toBe("waiting");
    expect(m.lastOf(1)).toBe(1);
    expect(m.inboxSize(0)).toBe(1);
    m.pump();
    expect(m.stateOf(1)).toBe("held");
    expect(m.hasToken(1)).toBe(true);
    expect(m.hasToken(0)).toBe(false);
    expect(m.lastOf(0)).toBe(1);
    expect(m.holder()).toBe(1);
  });

  test("two waiters sequential", () => {
    const { m } = make();
    m.request(1);
    m.pump();
    expect(m.holder()).toBe(1);
    m.request(2);
    m.pump();
    expect(m.stateOf(2)).toBe("waiting");
    expect(m.holder()).toBe(1);
    expect(m.nextOf(1)).toBe(2);
    m.release(1);
    expect(m.holder()).toBeNull();
    m.pump();
    expect(m.holder()).toBe(2);
    expect(m.stateOf(2)).toBe("held");
  });

  test("step path", () => {
    const { m } = make();
    m.request(2);
    expect(m.step(0)).toBe(true);
    expect(m.hasToken(0)).toBe(false);
    expect(m.inboxSize(2)).toBe(1);
    expect(m.step(2)).toBe(true);
    expect(m.stateOf(2)).toBe("held");
  });
});

describe("naimi exclusion", () => {
  test("only one held", () => {
    const { m } = make();
    m.request(0);
    m.request(1);
    m.pump();
    const held = [0, 1, 2].filter((i) => m.stateOf(i) === "held");
    expect(held).toEqual([0]);
    expect(m.stateOf(1)).toBe("waiting");
    m.release(0);
    m.pump();
    expect(m.stateOf(1)).toBe("held");
  });
});

describe("naimi offline", () => {
  test("offline cannot request or step", () => {
    const { m } = make();
    m.setOnline(2, false);
    expect(() => m.request(2)).toThrow(OfflineError);
    expect(() => m.step(2)).toThrow(OfflineError);
    m.request(1);
    m.pump();
    expect(m.holder()).toBe(1);
  });

  test("online later can request", () => {
    const { m } = make();
    m.setOnline(2, false);
    m.request(0);
    m.release(0);
    m.setOnline(2, true);
    m.request(2);
    m.pump();
    expect(m.holder()).toBe(2);
    expect(m.isRequesting(2)).toBe(true);
  });
});
