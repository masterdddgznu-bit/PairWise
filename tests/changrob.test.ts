import {
  VirtualClock,
  ChangRob,
  nextIndex,
  defaultUids,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 5, uids?: number[]) {
  const clock = new VirtualClock();
  const c = new ChangRob({ clock, processCount: n, uids });
  return { clock, c };
}

describe("changrob helpers", () => {
  test("nextIndex and defaultUids", () => {
    expect(nextIndex(0, 5)).toBe(1);
    expect(nextIndex(4, 5)).toBe(0);
    expect(defaultUids(3)).toEqual([0, 1, 2]);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new ChangRob({ clock, processCount: 1 })).toThrow(InvalidConfigError);
    expect(
      () => new ChangRob({ clock, processCount: 3, uids: [1, 1, 2] }),
    ).toThrow(InvalidConfigError);
    expect(() => new ChangRob({ clock }).start(9)).toThrow(InvalidProcessError);
  });
});

describe("changrob election", () => {
  test("start from low elects max uid", () => {
    const { c } = make(5);
    expect(c.start(0)).toBe("1");
    expect(c.isParticipant(0)).toBe(true);
    c.pump();
    expect(c.leader()).toBe(4);
    expect(c.leaderOf(0)).toBe(4);
    expect(c.leaderOf(4)).toBe(4);
    expect(c.isParticipant(0)).toBe(false);
  });

  test("start from max elects self", () => {
    const { c } = make(4);
    c.start(3);
    c.pump();
    expect(c.leader()).toBe(3);
  });

  test("custom uids elect highest", () => {
    const { c } = make(4, [2, 7, 1, 5]);
    expect(c.uidOf(1)).toBe(7);
    c.start(2); // uid 1
    c.pump();
    expect(c.leader()).toBe(7);
  });

  test("busy while participating", () => {
    const { c } = make(3);
    c.start(0);
    expect(() => c.start(0)).toThrow(BusyError);
    c.pump();
    c.start(1); // after done, can start again
    c.pump();
    expect(c.leader()).toBe(2);
  });
});

describe("changrob step", () => {
  test("election message circulates", () => {
    const { c } = make(3);
    c.start(0);
    expect(c.inboxSize(1)).toBe(1);
    expect(c.step(1)).toBe(true); // uid0 < uid1 → 1 starts own election
    expect(c.isParticipant(1)).toBe(true);
    expect(c.inboxSize(2)).toBe(1);
    c.pump();
    expect(c.leader()).toBe(2);
  });
});

describe("changrob offline", () => {
  test("offline cannot start or step", () => {
    const { c } = make(3);
    c.setOnline(1, false);
    expect(() => c.start(1)).toThrow(OfflineError);
    expect(() => c.step(1)).toThrow(OfflineError);
  });

  test("message waits in offline inbox then completes", () => {
    const { c } = make(3);
    c.setOnline(1, false);
    c.start(0); // ELECTION to 1's inbox
    expect(c.inboxSize(1)).toBe(1);
    c.pump(); // skips 1; 0 and 2 idle
    expect(c.leader()).toBeNull();
    c.setOnline(1, true);
    c.pump();
    expect(c.leader()).toBe(2);
    expect(c.nextOf(2)).toBe(0);
  });
});
