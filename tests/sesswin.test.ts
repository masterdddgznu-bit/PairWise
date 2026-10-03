import { VirtualClock } from "../src/clock.js";
import { InvalidConfigError } from "../src/errors.js";
import { SessWin } from "../src/sesswin.js";

describe("sesswin base tumbling", () => {
  test("config", () => {
    const clock = new VirtualClock();
    expect(() => new SessWin({ clock, mode: "tumbling" })).toThrow(InvalidConfigError);
    expect(() => new SessWin({ clock, mode: "session" })).toThrow(InvalidConfigError);
  });

  test("tumbling sums and flush order", () => {
    const clock = new VirtualClock();
    const s = new SessWin({ clock, mode: "tumbling", sizeMs: 10 });
    s.ingest("a", 0, 1);
    s.ingest("a", 5, 2);
    s.ingest("b", 5, 7);
    s.ingest("a", 10, 3);
    // watermark = maxEvent=10, lateness 0
    expect(s.watermark()).toBe(10);
    expect(s.flushReady()).toEqual([
      { key: "a", start: 0, end: 10, sum: 3 },
      { key: "b", start: 0, end: 10, sum: 7 },
    ]);
    s.ingest("a", 20, 1);
    expect(s.flushReady()).toEqual([{ key: "a", start: 10, end: 20, sum: 3 }]);
  });

  test("tumbling export import", () => {
    const clock = new VirtualClock();
    const s = new SessWin({ clock, mode: "tumbling", sizeMs: 10 });
    s.ingest("a", 1, 4);
    const snap = s.exportState();
    const s2 = new SessWin({ clock, mode: "tumbling", sizeMs: 10 });
    s2.importState(snap);
    s2.ingest("a", 12, 0);
    expect(s2.flushReady()).toEqual([{ key: "a", start: 0, end: 10, sum: 4 }]);
  });
});

describe("sesswin features", () => {
  test("session merges within gap and closes by watermark", () => {
    const clock = new VirtualClock();
    const s = new SessWin({ clock, mode: "session", gapMs: 5 });
    s.ingest("k", 0, 1);
    s.ingest("k", 4, 2);
    s.ingest("k", 12, 3); // gap 8 > 5 → new session; old end=4+5=9
    expect(s.watermark()).toBe(12);
    expect(s.flushReady()).toEqual([{ key: "k", start: 0, end: 9, sum: 3 }]);
    s.ingest("k", 20, 1);
    expect(s.flushReady()).toEqual([{ key: "k", start: 12, end: 17, sum: 3 }]);
  });

  test("allowed lateness holds window and drops late to side output", () => {
    const clock = new VirtualClock();
    const s = new SessWin({
      clock,
      mode: "tumbling",
      sizeMs: 10,
      allowedLatenessMs: 5,
    });
    s.ingest("a", 9, 1); // window [0,10), wm = 4
    expect(s.watermark()).toBe(4);
    expect(s.flushReady()).toEqual([]);
    s.ingest("a", 2, 9); // 2 < 4 → late
    expect(s.lateEvents()).toEqual([{ key: "a", eventTime: 2, value: 9 }]);
    s.ingest("a", 16, 2); // wm = 11; [0,10) becomes ready
    expect(s.watermark()).toBe(11);
    expect(s.flushReady()).toEqual([{ key: "a", start: 0, end: 10, sum: 1 }]);
  });

  test("watermark is monotonic even if event times go backwards", () => {
    const clock = new VirtualClock();
    const s = new SessWin({ clock, mode: "tumbling", sizeMs: 10, allowedLatenessMs: 0 });
    s.observe(50);
    expect(s.watermark()).toBe(50);
    s.observe(40);
    expect(s.watermark()).toBe(50);
  });

  test("session export import resumes", () => {
    const clock = new VirtualClock();
    const s = new SessWin({ clock, mode: "session", gapMs: 3 });
    s.ingest("x", 0, 1);
    s.ingest("x", 2, 1);
    const snap = s.exportState();
    const s2 = new SessWin({ clock, mode: "session", gapMs: 3 });
    s2.importState(snap);
    s2.ingest("x", 10, 5);
    expect(s2.flushReady()).toEqual([{ key: "x", start: 0, end: 5, sum: 2 }]);
  });

  test("session isolates keys", () => {
    const clock = new VirtualClock();
    const s = new SessWin({ clock, mode: "session", gapMs: 5 });
    s.ingest("a", 0, 1);
    s.ingest("b", 1, 2);
    s.ingest("a", 10, 3);
    expect(s.flushReady()).toEqual([
      { key: "a", start: 0, end: 5, sum: 1 },
      { key: "b", start: 1, end: 6, sum: 2 },
    ]);
  });

  test("clearLate only clears side output", () => {
    const clock = new VirtualClock();
    const s = new SessWin({
      clock,
      mode: "tumbling",
      sizeMs: 10,
      allowedLatenessMs: 0,
    });
    s.ingest("a", 20, 1);
    s.ingest("a", 5, 2);
    expect(s.lateEvents().length).toBe(1);
    s.clearLate();
    expect(s.lateEvents()).toEqual([]);
    s.ingest("a", 30, 0);
    expect(s.flushReady()).toEqual([{ key: "a", start: 20, end: 30, sum: 1 }]);
  });
});
