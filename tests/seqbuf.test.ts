import {
  VirtualClock,
  SeqBuf,
  InvalidSeqError,
  OutOfWindowError,
  DuplicateSeqError,
  WindowSlots,
  deliverContiguous,
  GapTracker,
} from "../src/index.js";

function make(opts?: { windowSize?: number; gapTimeout?: number; startExpect?: number }) {
  const clock = new VirtualClock();
  const buf = new SeqBuf({
    clock,
    windowSize: opts?.windowSize ?? 8,
    gapTimeout: opts?.gapTimeout ?? 10,
    startExpect: opts?.startExpect ?? 0,
  });
  return { clock, buf };
}

describe("seqbuf helpers", () => {
  test("deliverContiguous pops prefix", () => {
    const slots = new WindowSlots(8, 0);
    slots.put({ seq: 0, payload: "a" });
    slots.put({ seq: 1, payload: "b" });
    slots.put({ seq: 3, payload: "d" });
    const r = deliverContiguous(slots, 0);
    expect(r.delivered.map((x) => x.payload)).toEqual(["a", "b"]);
    expect(r.newExpect).toBe(2);
    expect(slots.has(3)).toBe(true);
  });

  test("GapTracker marks once and times out", () => {
    const g = new GapTracker();
    g.mark(5);
    g.mark(6);
    expect(g.getSince()).toBe(5);
    expect(g.timedOut(14, 10)).toBe(false);
    expect(g.timedOut(15, 10)).toBe(true);
    g.clear();
    expect(g.getSince()).toBe(null);
  });
});

describe("seqbuf push deliver", () => {
  test("in-order push delivers immediately", () => {
    const { buf } = make();
    expect(buf.push(0, "a")).toEqual([{ seq: 0, payload: "a" }]);
    expect(buf.expect()).toBe(1);
    expect(buf.bufferedCount()).toBe(0);
  });

  test("out-of-order then fill gap", () => {
    const { buf } = make();
    expect(buf.push(2, "c")).toEqual([]);
    expect(buf.bufferedCount()).toBe(1);
    expect(buf.push(1, "b")).toEqual([]);
    expect(buf.bufferedCount()).toBe(2);
    expect(buf.push(0, "a")).toEqual([
      { seq: 0, payload: "a" },
      { seq: 1, payload: "b" },
      { seq: 2, payload: "c" },
    ]);
    expect(buf.expect()).toBe(3);
    expect(buf.bufferedCount()).toBe(0);
  });

  test("duplicate below expect ignored", () => {
    const { buf } = make();
    buf.push(0, "a");
    expect(buf.push(0, "a2")).toEqual([]);
    expect(buf.expect()).toBe(1);
  });

  test("duplicate in window throws", () => {
    const { buf } = make();
    buf.push(2, "c");
    expect(() => buf.push(2, "c2")).toThrow(DuplicateSeqError);
  });

  test("out of window throws", () => {
    const { buf } = make({ windowSize: 4 });
    expect(() => buf.push(4, "x")).toThrow(OutOfWindowError);
    buf.push(0, "a");
    expect(() => buf.push(5, "y")).toThrow(OutOfWindowError);
  });

  test("negative seq throws", () => {
    const { buf } = make();
    expect(() => buf.push(-1, "x")).toThrow(InvalidSeqError);
  });

  test("window advances after deliver", () => {
    const { buf } = make({ windowSize: 4 });
    buf.push(0, "a");
    buf.push(1, "b");
    buf.push(2, "c");
    buf.push(3, "d");
    expect(buf.expect()).toBe(4);
    expect(buf.push(4, "e")).toEqual([{ seq: 4, payload: "e" }]);
  });
});

describe("seqbuf gap timeout", () => {
  test("gap timeout skips missing seq then delivers", () => {
    const { clock, buf } = make({ gapTimeout: 5, windowSize: 8 });
    buf.push(1, "b");
    expect(buf.expect()).toBe(0);
    expect(buf.bufferedCount()).toBe(1);
    for (let i = 0; i < 4; i++) expect(buf.tick()).toEqual([]);
    expect(clock.now()).toBe(4);
    const d = buf.tick();
    expect(clock.now()).toBe(5);
    expect(buf.skipped()).toEqual([0]);
    expect(d).toEqual([{ seq: 1, payload: "b" }]);
    expect(buf.expect()).toBe(2);
  });

  test("gap timer starts when higher seq buffered", () => {
    const { clock, buf } = make({ gapTimeout: 3 });
    clock.advance(10);
    buf.push(2, "c");
    // gapSince should be 10
    expect(buf.tick()).toEqual([]); // 11
    expect(buf.tick()).toEqual([]); // 12
    const d = buf.tick(); // 13 -> timeout
    expect(d).toEqual([]);
    expect(buf.skipped()).toEqual([0]);
    expect(buf.expect()).toBe(1);
    // still missing 1, buffered 2
    expect(buf.tick()).toEqual([]);
    expect(buf.tick()).toEqual([]);
    const d2 = buf.tick();
    expect(buf.skipped()).toEqual([0, 1]);
    expect(d2).toEqual([{ seq: 2, payload: "c" }]);
  });

  test("filling gap clears skip path", () => {
    const { buf } = make({ gapTimeout: 5 });
    buf.push(1, "b");
    buf.tick();
    buf.tick();
    expect(buf.push(0, "a")).toEqual([
      { seq: 0, payload: "a" },
      { seq: 1, payload: "b" },
    ]);
    expect(buf.skipped()).toEqual([]);
    buf.tick();
    buf.tick();
    buf.tick();
    expect(buf.skipped()).toEqual([]);
  });

  test("reclaimGaps without timeout is noop", () => {
    const { buf } = make({ gapTimeout: 10 });
    buf.push(1, "b");
    expect(buf.reclaimGaps()).toEqual([]);
    expect(buf.skipped()).toEqual([]);
  });

  test("deliverAll does not skip", () => {
    const { buf } = make();
    buf.push(1, "b");
    expect(buf.deliverAll()).toEqual([]);
    expect(buf.expect()).toBe(0);
  });

  test("multiple buffered after skip", () => {
    const { buf } = make({ gapTimeout: 2, windowSize: 8 });
    buf.push(2, "c");
    buf.push(3, "d");
    buf.tick();
    expect(buf.tick()).toEqual([]);
    // skipped 0, expect=1 still empty
    expect(buf.skipped()).toEqual([0]);
    buf.tick();
    expect(buf.tick()).toEqual([
      { seq: 2, payload: "c" },
      { seq: 3, payload: "d" },
    ]);
    expect(buf.skipped()).toEqual([0, 1]);
  });

  test("startExpect nonzero", () => {
    const { buf } = make({ startExpect: 5, windowSize: 4 });
    expect(buf.push(5, "x")).toEqual([{ seq: 5, payload: "x" }]);
    expect(buf.expect()).toBe(6);
  });

  test("empty tick without buffer", () => {
    const { clock, buf } = make();
    expect(buf.tick()).toEqual([]);
    expect(clock.now()).toBe(1);
  });
});
