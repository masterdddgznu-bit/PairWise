import {
  CapacityError,
  DebtBlockedError,
  DuplicateIdError,
  InvalidConfigError,
  InvalidIdError,
  QuarantineError,
  SlideWin,
  VirtualClock,
} from "../src/index.js";

function win(opts?: {
  windowMs?: number;
  maxEvents?: number;
  debtHealPerDrive?: number;
}) {
  const clock = new VirtualClock();
  const w = new SlideWin({
    clock,
    windowMs: opts?.windowMs ?? 10,
    maxEvents: opts?.maxEvents ?? 2,
    debtHealPerDrive: opts?.debtHealPerDrive,
  });
  return { clock, w };
}

describe("slidewin hell 0-1", () => {
  test("rejects invalid config and ids", () => {
    const clock = new VirtualClock();
    expect(() => new SlideWin({ clock, windowMs: 0, maxEvents: 2 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new SlideWin({ clock, windowMs: 1, maxEvents: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(
      () => new SlideWin({ clock, windowMs: 1, maxEvents: 1, debtHealPerDrive: 0 }),
    ).toThrow(InvalidConfigError);
    const { w } = win();
    expect(() => w.admit("")).toThrow(InvalidIdError);
    expect(() => w.admittedAt("")).toThrow(InvalidIdError);
  });

  test("admit/cancel basic; duplicate rejected", () => {
    const { w } = win({ maxEvents: 4 });
    expect(w.admit("a").status).toBe("accepted");
    expect(() => w.admit("a")).toThrow(DuplicateIdError);
    expect(w.cancel("a")).toBe(true);
    expect(w.cancel("a")).toBe(false);
    expect(w.admit("a").status).toBe("accepted");
  });

  test("capacity over-admit adds debt and blocks further admits", () => {
    const { w } = win({ maxEvents: 2, debtHealPerDrive: 1 });
    w.admit("a");
    w.admit("b");
    expect(() => w.admit("c")).toThrow(CapacityError);
    expect(w.debt()).toBe(1);
    expect(() => w.admit("d")).toThrow(DebtBlockedError);
    expect(w.size()).toBe(2);
  });

  test("drive purges then heals debt", () => {
    const { clock, w } = win({
      windowMs: 5,
      maxEvents: 1,
      debtHealPerDrive: 1,
    });
    w.admit("a");
    expect(() => w.admit("b")).toThrow(CapacityError);
    expect(w.debt()).toBe(1);
    clock.advance(5);
    // queries do not purge or heal
    expect(w.count()).toBe(0);
    expect(w.size()).toBe(1);
    expect(w.debt()).toBe(1);
    expect(w.drive()).toEqual({ purged: ["a"], healed: 1 });
    expect(w.debt()).toBe(0);
    expect(w.admit("b").status).toBe("accepted");
  });

  test("quarantine excludes from count and blocks admit", () => {
    const { w } = win({ maxEvents: 1, windowMs: 100 });
    w.admit("a");
    w.quarantine("a");
    expect(w.isQuarantined("a")).toBe(true);
    expect(w.count()).toBe(0);
    expect(w.inWindowIds()).toEqual([]);
    expect(w.size()).toBe(1);
    // capacity freed for counting → can admit b
    expect(w.admit("b").status).toBe("accepted");
    expect(() => w.admit("a")).toThrow(QuarantineError);
    expect(w.clearQuarantine("a")).toBe(true);
    expect(() => w.admit("a")).toThrow(DuplicateIdError);
  });

  test("pre-quarantine blocks admit before registration", () => {
    const { w } = win({ maxEvents: 4 });
    w.quarantine("x");
    expect(() => w.admit("x")).toThrow(QuarantineError);
    expect(w.clearQuarantine("x")).toBe(true);
    expect(w.admit("x").status).toBe("accepted");
  });

  test("exact boundary now - ts === windowMs is out", () => {
    const { clock, w } = win({ windowMs: 5, maxEvents: 4 });
    w.admit("a");
    clock.advance(4);
    expect(w.inWindowIds()).toEqual(["a"]);
    clock.advance(1);
    expect(w.count()).toBe(0);
    expect(w.size()).toBe(1);
  });

  test("queries never purge; drive order first-admit", () => {
    const { clock, w } = win({ windowMs: 3, maxEvents: 8 });
    w.admit("z");
    clock.advance(1);
    w.admit("a");
    clock.advance(1);
    w.admit("m");
    clock.advance(2);
    expect(w.count()).toBe(1);
    expect(w.size()).toBe(3);
    expect(w.ids()).toEqual(["z", "a", "m"]);
    expect(w.drive().purged).toEqual(["z", "a"]);
  });

  test("cancel lazy-sweeps; cancel does not heal debt", () => {
    const { clock, w } = win({ windowMs: 4, maxEvents: 1 });
    w.admit("a");
    expect(() => w.admit("b")).toThrow(CapacityError);
    expect(w.cancel("a")).toBe(true);
    expect(w.debt()).toBe(1);
    expect(() => w.admit("c")).toThrow(DebtBlockedError);
    clock.advance(1);
    expect(w.drive()).toEqual({ purged: [], healed: 1 });
  });

  test("partial window slide; quarantine mid-window frees slot", () => {
    const { clock, w } = win({ windowMs: 10, maxEvents: 2 });
    w.admit("a");
    clock.advance(5);
    w.admit("b");
    expect(() => w.admit("c")).toThrow(CapacityError);
    expect(w.debt()).toBe(1);
    // heal via drive without waiting full slide
    expect(w.drive().healed).toBe(1);
    w.quarantine("a");
    expect(w.count()).toBe(1);
    expect(w.admit("c").status).toBe("accepted");
    expect(w.inWindowIds()).toEqual(["b", "c"]);
  });

  test("debtHealPerDrive can clear multiple penalties across drives", () => {
    const { clock, w } = win({
      windowMs: 100,
      maxEvents: 1,
      debtHealPerDrive: 2,
    });
    w.admit("a");
    expect(() => w.admit("b")).toThrow(CapacityError);
    expect(() => w.admit("c")).toThrow(DebtBlockedError);
    // still debt 1; need another capacity hit after heal
    expect(w.drive()).toEqual({ purged: [], healed: 1 });
    expect(() => w.admit("b")).toThrow(CapacityError);
    expect(w.debt()).toBe(1);
    w.cancel("a");
    expect(w.drive().healed).toBe(1);
    expect(w.admit("d").status).toBe("accepted");
    void clock;
  });

  test("interleaved admit cancel quarantine drive debt", () => {
    const { clock, w } = win({
      windowMs: 6,
      maxEvents: 2,
      debtHealPerDrive: 1,
    });
    w.admit("a");
    w.admit("b");
    expect(() => w.admit("c")).toThrow(CapacityError);
    expect(w.cancel("b")).toBe(true);
    // debt still blocks
    expect(() => w.admit("d")).toThrow(DebtBlockedError);
    expect(w.drive().healed).toBe(1);
    w.quarantine("a");
    expect(w.count()).toBe(0);
    expect(w.admit("d").status).toBe("accepted");
    clock.advance(6);
    expect(w.count()).toBe(0);
    expect(w.size()).toBe(2);
    expect(w.drive().purged).toEqual(["a", "d"]);
  });

  test("admittedAt visible for stale until purged", () => {
    const { clock, w } = win({ windowMs: 2, maxEvents: 4 });
    w.admit("x");
    clock.advance(2);
    expect(w.admittedAt("x")).toBe(0);
    w.drive();
    expect(w.admittedAt("x")).toBeNull();
  });

  test("inWindowIds ignores quarantined even if still in window", () => {
    const { w } = win({ windowMs: 50, maxEvents: 4 });
    w.admit("p");
    w.admit("q");
    w.quarantine("p");
    expect(w.inWindowIds()).toEqual(["q"]);
    expect(w.ids()).toEqual(["p", "q"]);
  });

  test("many advances keep relative membership; debt independent of queries", () => {
    const { clock, w } = win({ windowMs: 100, maxEvents: 2 });
    w.admit("a");
    clock.advance(40);
    w.admit("b");
    clock.advance(40);
    expect(() => w.admit("c")).toThrow(CapacityError);
    expect(w.debt()).toBe(1);
    clock.advance(30);
    expect(w.inWindowIds()).toEqual(["b"]);
    expect(w.count()).toBe(1);
    expect(w.size()).toBe(2);
    expect(w.debt()).toBe(1);
  });

  test("clearQuarantine false when not flagged", () => {
    const { w } = win();
    expect(w.clearQuarantine("nope")).toBe(false);
  });
});
