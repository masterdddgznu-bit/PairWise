import {
  VirtualClock,
  Hirsch,
  leftIndex,
  rightIndex,
  defaultUids,
  hopForPhase,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 5, uids?: number[]) {
  const clock = new VirtualClock();
  const h = new Hirsch({ clock, processCount: n, uids });
  return { clock, h };
}

describe("hirsch helpers", () => {
  test("ring helpers", () => {
    expect(leftIndex(0, 5)).toBe(4);
    expect(rightIndex(4, 5)).toBe(0);
    expect(defaultUids(3)).toEqual([0, 1, 2]);
    expect(hopForPhase(0)).toBe(1);
    expect(hopForPhase(2)).toBe(4);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Hirsch({ clock, processCount: 2 })).toThrow(InvalidConfigError);
    expect(
      () => new Hirsch({ clock, processCount: 3, uids: [1, 1, 2] }),
    ).toThrow(InvalidConfigError);
    expect(() => new Hirsch({ clock }).start(9)).toThrow(InvalidProcessError);
  });
});

describe("hirsch election", () => {
  test("start from low elects max", () => {
    const { h } = make(5);
    expect(h.start(0)).toBe("1");
    expect(h.isParticipant(0)).toBe(true);
    h.pump();
    expect(h.leader()).toBe(4);
    expect(h.leaderOf(0)).toBe(4);
    expect(h.leaderOf(4)).toBe(4);
    expect(h.isParticipant(0)).toBe(false);
  });

  test("start from max elects self", () => {
    const { h } = make(4);
    h.start(3);
    h.pump();
    expect(h.leader()).toBe(3);
  });

  test("custom uids", () => {
    const { h } = make(4, [3, 9, 1, 6]);
    expect(h.uidOf(1)).toBe(9);
    h.start(2);
    h.pump();
    expect(h.leader()).toBe(9);
  });

  test("busy while participating", () => {
    const { h } = make(3);
    h.start(0);
    expect(() => h.start(0)).toThrow(BusyError);
    h.pump();
    h.start(1);
    h.pump();
    expect(h.leader()).toBe(2);
  });
});

describe("hirsch step", () => {
  test("phase0 probe reply then advance", () => {
    const { h } = make(3);
    // uids 0,1,2 — start from 2 (max) so probes come back as elected sooner;
    // use start from 1: probes to 0 and 2
    h.start(1);
    expect(h.inboxSize(0)).toBe(1);
    expect(h.inboxSize(2)).toBe(1);
    // 0 gets PROBE uid1 > 0, hop1 → REPLY back to 1
    expect(h.step(0)).toBe(true);
    expect(h.inboxSize(1)).toBe(1);
    // 2 gets PROBE uid1 < 2 → swallow and start own election
    expect(h.step(2)).toBe(true);
    expect(h.isParticipant(2)).toBe(true);
    // pump rest
    h.pump();
    expect(h.leader()).toBe(2);
  });
});

describe("hirsch offline", () => {
  test("offline cannot start or step", () => {
    const { h } = make(3);
    h.setOnline(1, false);
    expect(() => h.start(1)).toThrow(OfflineError);
    expect(() => h.step(1)).toThrow(OfflineError);
  });

  test("message waits offline then completes", () => {
    const { h } = make(3);
    h.setOnline(1, false);
    h.start(0);
    expect(h.inboxSize(1)).toBeGreaterThan(0);
    h.pump();
    expect(h.leader()).toBeNull();
    h.setOnline(1, true);
    h.pump();
    expect(h.leader()).toBe(2);
    expect(h.leftOf(0)).toBe(2);
    expect(h.rightOf(0)).toBe(1);
  });
});
