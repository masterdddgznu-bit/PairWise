import {
  VirtualClock,
  Maekawa,
  intersect,
  defaultVotingSets,
  BusyError,
  NotHolderError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 3, votingSets?: number[][]) {
  const clock = new VirtualClock();
  const m = new Maekawa({ clock, processCount: n, votingSets });
  return { clock, m };
}

describe("maekawa helpers", () => {
  test("intersect and default sets", () => {
    expect(intersect([0, 1], [1, 2])).toBe(true);
    expect(intersect([0, 1], [2])).toBe(false);
    const s = defaultVotingSets(3);
    expect(s).toEqual([
      [0, 1],
      [1, 2],
      [0, 2],
    ]);
    expect(intersect(s[0]!, s[1]!)).toBe(true);
    expect(intersect(s[0]!, s[2]!)).toBe(true);
    expect(intersect(s[1]!, s[2]!)).toBe(true);
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new Maekawa({ clock, processCount: 4 })).toThrow(InvalidConfigError);
    expect(
      () => new Maekawa({ clock, processCount: 3, votingSets: [[0], [1], [2]] }),
    ).toThrow(InvalidConfigError);
    expect(() => new Maekawa({ clock }).request(9)).toThrow(InvalidProcessError);
  });
});

describe("maekawa enter leave", () => {
  test("single request enters after pump", () => {
    const { m } = make();
    expect(m.request(0)).toBe("1");
    expect(m.stateOf(0)).toBe("waiting");
    m.pump();
    expect(m.stateOf(0)).toBe("held");
    expect(m.holder()).toBe(0);
    expect(m.repliesOf(0)).toEqual([0, 1]);
    expect(m.votingFor(0)).toBe(0);
    expect(m.votingFor(1)).toBe(0);
  });

  test("busy and not holder", () => {
    const { m } = make();
    m.request(0);
    expect(() => m.request(0)).toThrow(BusyError);
    expect(() => m.release(0)).toThrow(NotHolderError);
    m.pump();
    expect(() => m.request(0)).toThrow(BusyError);
    m.release(0);
    m.pump();
    expect(m.stateOf(0)).toBe("idle");
    expect(m.holder()).toBeNull();
  });
});

describe("maekawa exclusion", () => {
  test("two concurrent only lower ts holds", () => {
    const { m } = make();
    m.request(0);
    m.request(1);
    m.pump();
    expect(m.holder()).toBe(0);
    expect(m.stateOf(1)).toBe("waiting");
    expect(m.queuedAt(1)).toEqual([1]);
  });

  test("release then waiter enters", () => {
    const { m } = make();
    m.request(0);
    m.request(1);
    m.pump();
    expect(m.holder()).toBe(0);
    m.release(0);
    m.pump();
    expect(m.holder()).toBe(1);
    expect(m.stateOf(0)).toBe("idle");
    expect(m.repliesOf(1)).toEqual([1, 2]);
  });

  test("later requester waits behind earlier", () => {
    const { m } = make();
    m.request(1);
    m.pump();
    expect(m.holder()).toBe(1);
    m.request(0);
    m.pump();
    expect(m.holder()).toBe(1);
    expect(m.stateOf(0)).toBe("waiting");
    m.release(1);
    m.pump();
    expect(m.holder()).toBe(0);
  });
});

describe("maekawa step pump", () => {
  test("step consumes one inbox item", () => {
    const { m } = make();
    m.request(0);
    expect(m.inboxSize(0)).toBe(1);
    expect(m.inboxSize(1)).toBe(1);
    expect(m.step(0)).toBe(true);
    expect(m.votingFor(0)).toBe(0);
    expect(m.step(0)).toBe(true); // self REPLY
    expect(m.repliesOf(0)).toEqual([0]);
    expect(m.stateOf(0)).toBe("waiting");
    m.pump(1);
    m.pump(0);
    expect(m.stateOf(0)).toBe("held");
  });

  test("lamport increments per request", () => {
    const { m } = make();
    m.request(0);
    expect(m.lamportOf(0)).toBe(1);
    m.pump();
    m.release(0);
    m.pump();
    m.request(0);
    expect(m.lamportOf(0)).toBe(2);
  });
});

describe("maekawa offline", () => {
  test("offline cannot request or step", () => {
    const { m } = make();
    m.setOnline(2, false);
    expect(() => m.request(2)).toThrow(OfflineError);
    expect(() => m.step(2)).toThrow(OfflineError);
    m.request(0);
    m.pump();
    expect(m.holder()).toBe(0);
  });

  test("online later can request", () => {
    const { m } = make();
    m.setOnline(2, false);
    m.request(0);
    m.pump();
    expect(m.holder()).toBe(0);
    m.release(0);
    m.pump();
    m.setOnline(2, true);
    m.request(2);
    m.pump();
    expect(m.holder()).toBe(2);
    expect(m.votingSet(2)).toEqual([0, 2]);
  });
});
