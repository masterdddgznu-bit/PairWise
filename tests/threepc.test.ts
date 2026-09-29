import {
  VirtualClock,
  ThreePc,
  BusyError,
  OfflineError,
  InvalidConfigError,
  InvalidProcessError,
} from "../src/index.js";

function make(n = 3, voteTimeout = 10, precommitTimeout = 10) {
  const clock = new VirtualClock();
  const t = new ThreePc({ clock, cohortCount: n, voteTimeout, precommitTimeout });
  return { clock, t };
}

describe("threepc init", () => {
  test("idle start", () => {
    const { t } = make();
    expect(t.phase()).toBe("idle");
    expect(t.outcome()).toBe("pending");
    expect(t.txId()).toBeNull();
  });

  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new ThreePc({ clock, cohortCount: 0 })).toThrow(InvalidConfigError);
    expect(() => new ThreePc({ clock, voteTimeout: 0 })).toThrow(InvalidConfigError);
    expect(() => new ThreePc({ clock }).setVote(9, true)).toThrow(InvalidProcessError);
  });
});

describe("threepc happy path", () => {
  test("all yes commits", () => {
    const { t } = make();
    expect(t.begin()).toBe("1");
    expect(t.phase()).toBe("voting");
    t.pump();
    expect(t.phase()).toBe("committed");
    expect(t.outcome()).toBe("committed");
    expect(t.cohortState(0)).toBe("committed");
    expect(t.cohortState(1)).toBe("committed");
    expect(t.votes()).toEqual([
      { id: 0, yes: true },
      { id: 1, yes: true },
      { id: 2, yes: true },
    ]);
    expect(t.acks()).toEqual([0, 1, 2]);
  });

  test("can begin again after commit", () => {
    const { t } = make();
    t.begin();
    t.pump();
    expect(t.begin()).toBe("2");
    t.pump();
    expect(t.outcome()).toBe("committed");
  });
});

describe("threepc abort paths", () => {
  test("no vote aborts", () => {
    const { t } = make();
    t.setVote(1, false);
    t.begin();
    t.pump();
    expect(t.outcome()).toBe("aborted");
    expect(t.cohortState(0)).toBe("aborted");
    expect(t.cohortState(1)).toBe("aborted");
  });

  test("vote timeout aborts", () => {
    const { t } = make(3, 5, 10);
    t.setOnline(2, false);
    t.begin(); // snapshot = 0,1
    t.setOnline(2, true);
    // only step 0 → one vote; never get vote from 1
    t.step(0);
    t.stepCoordinator();
    expect(t.votes()).toEqual([{ id: 0, yes: true }]);
    t.advance(5);
    expect(t.stepCoordinator()).toBe(true);
    expect(t.phase()).toBe("aborted");
    t.pump();
    expect(t.cohortState(0)).toBe("aborted");
    expect(t.cohortState(1)).toBe("aborted");
  });

  test("busy during voting", () => {
    const { t } = make();
    t.begin();
    expect(() => t.begin()).toThrow(BusyError);
    t.pump();
  });
});

describe("threepc offline", () => {
  test("offline cohort skipped at begin", () => {
    const { t } = make();
    t.setOnline(2, false);
    t.begin();
    t.pump();
    expect(t.outcome()).toBe("committed");
    expect(t.votes().map((v) => v.id)).toEqual([0, 1]);
    expect(t.cohortState(2)).toBe("idle");
  });

  test("offline cannot step", () => {
    const { t } = make();
    t.setOnline(1, false);
    expect(() => t.step(1)).toThrow(OfflineError);
  });

  test("no online cohorts aborts immediately", () => {
    const { t } = make();
    t.setOnline(0, false);
    t.setOnline(1, false);
    t.setOnline(2, false);
    t.begin();
    expect(t.phase()).toBe("aborted");
    expect(t.outcome()).toBe("aborted");
  });
});
