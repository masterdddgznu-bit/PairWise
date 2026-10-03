import { VirtualClock } from "../src/clock.js";
import { InvalidConfigError } from "../src/errors.js";
import { LeaseWheel } from "../src/leasewheel.js";

function make(slotCount = 8, tickMs = 10) {
  const clock = new VirtualClock();
  const w = new LeaseWheel<string>({ clock, slotCount, tickMs });
  return { clock, w };
}

describe("leasewheel config", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new LeaseWheel({ clock, slotCount: 1, tickMs: 10 })).toThrow(InvalidConfigError);
    expect(() => new LeaseWheel({ clock, slotCount: 4, tickMs: 0 })).toThrow(InvalidConfigError);
  });
});

describe("leasewheel happy paths", () => {
  test("simple schedule expire", () => {
    const { clock, w } = make();
    w.schedule("a", 20, "A");
    expect(w.has("a")).toBe(true);
    clock.advance(10);
    w.drive();
    expect(w.pollExpired()).toEqual([]);
    clock.advance(10);
    w.drive();
    expect(w.pollExpired()).toEqual([{ leaseId: "a", payload: "A", expireAt: 20 }]);
    expect(w.has("a")).toBe(false);
  });

  test("cancel prevents expire", () => {
    const { clock, w } = make();
    w.schedule("a", 30, "A");
    expect(w.cancel("a")).toBe(true);
    clock.advance(50);
    w.drive();
    expect(w.pollExpired()).toEqual([]);
    expect(w.cancel("a")).toBe(false);
  });
});

describe("leasewheel boundaries", () => {
  test("exact boundary now==expireAt is expired", () => {
    const { clock, w } = make(4, 10);
    w.schedule("b", 10, "B");
    clock.advance(10);
    w.drive();
    expect(w.pollExpired()).toEqual([{ leaseId: "b", payload: "B", expireAt: 10 }]);
  });

  test("renew moves expiry and drops old slot", () => {
    const { clock, w } = make(8, 10);
    w.schedule("x", 20, "old");
    clock.advance(10);
    w.drive();
    w.schedule("x", 30, "new");
    clock.advance(10);
    w.drive();
    expect(w.pollExpired()).toEqual([]);
    clock.advance(20);
    w.drive();
    expect(w.pollExpired()).toEqual([{ leaseId: "x", payload: "new", expireAt: 40 }]);
  });

  test("multi lease same tick sorted by expireAt then id", () => {
    const { clock, w } = make(8, 10);
    w.schedule("m", 20, "M");
    w.schedule("k", 20, "K");
    w.schedule("z", 30, "Z");
    clock.advance(20);
    w.drive();
    expect(w.pollExpired()).toEqual([
      { leaseId: "k", payload: "K", expireAt: 20 },
      { leaseId: "m", payload: "M", expireAt: 20 },
    ]);
    clock.advance(10);
    w.drive();
    expect(w.pollExpired()).toEqual([{ leaseId: "z", payload: "Z", expireAt: 30 }]);
  });

  test("large jump across multiple ticks", () => {
    const { clock, w } = make(4, 10);
    w.schedule("p", 15, "P");
    w.schedule("q", 35, "Q");
    clock.advance(40);
    w.drive();
    const got = w.pollExpired();
    expect(got.map((x) => x.leaseId).sort()).toEqual(["p", "q"]);
    expect(w.size()).toBe(0);
  });

  test("wrap around wheel", () => {
    const { clock, w } = make(4, 10);
    w.schedule("w", 50, "W"); // > one full ring
    clock.advance(50);
    w.drive();
    expect(w.pollExpired()).toEqual([{ leaseId: "w", payload: "W", expireAt: 50 }]);
  });
});
