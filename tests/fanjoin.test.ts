import {
  VirtualClock,
  FanJoin,
  InvalidConfigError,
  UnknownProducerError,
  InvalidSeqError,
} from "../src/index.js";

function fj(
  o: Partial<{
    producers: string[];
    bufSize: number;
    gapTimeoutMs: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const j = new FanJoin({
    clock,
    producers: o.producers ?? ["b", "a"],
    bufSize: o.bufSize ?? 2,
    gapTimeoutMs: o.gapTimeoutMs ?? 10,
  });
  return { clock, j };
}

describe("fanjoin hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () =>
        new FanJoin({
          clock,
          producers: [],
          bufSize: 1,
          gapTimeoutMs: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new FanJoin({
          clock,
          producers: ["a", "a"],
          bufSize: 1,
          gapTimeoutMs: 1,
        }),
    ).toThrow(InvalidConfigError);
    expect(
      () =>
        new FanJoin({
          clock,
          producers: ["a"],
          bufSize: 0,
          gapTimeoutMs: 1,
        }),
    ).toThrow(InvalidConfigError);
  });

  test("producers sorted; join when all have seq", () => {
    const { j } = fj();
    expect(j.producers()).toEqual(["a", "b"]);
    expect(j.push("a", 1, "A1")).toBe("accepted");
    expect(j.poll()).toEqual([]);
    expect(j.push("b", 1, "B1")).toBe("accepted");
    expect(j.poll()).toEqual([
      { seq: 1, values: { a: "A1", b: "B1" }, missing: [] },
    ]);
    expect(j.joinNext()).toBe(2);
  });

  test("ooo buffer then join advances continuously", () => {
    const { j } = fj({ bufSize: 3 });
    j.push("a", 2, "A2");
    j.push("b", 1, "B1");
    j.push("b", 2, "B2");
    expect(j.poll()).toEqual([]);
    j.push("a", 1, "A1");
    expect(j.poll()).toEqual([
      { seq: 1, values: { a: "A1", b: "B1" }, missing: [] },
      { seq: 2, values: { a: "A2", b: "B2" }, missing: [] },
    ]);
  });

  test("duplicate and drop", () => {
    const { j } = fj({ bufSize: 1 });
    expect(j.push("a", 2, "x")).toBe("accepted");
    expect(j.push("a", 2, "y")).toBe("duplicate");
    expect(j.push("a", 3, "z")).toBe("dropped");
    j.push("a", 1, "A1");
    expect(j.nextOf("a")).toBe(3);
  });

  test("gap skip produces missing in join", () => {
    const { clock, j } = fj({ gapTimeoutMs: 5, bufSize: 2 });
    j.push("a", 2, "A2");
    j.push("b", 1, "B1");
    clock.advance(5);
    expect(j.drive().skipped).toEqual([{ producer: "a", seq: 1 }]);
    // join seq1: a skipped, b value — but b only has 1, a has skipped@1 and value@2
    expect(j.poll()).toEqual([
      { seq: 1, values: { b: "B1" }, missing: ["a"] },
    ]);
    j.push("b", 2, "B2");
    expect(j.poll()).toEqual([
      { seq: 2, values: { a: "A2", b: "B2" }, missing: [] },
    ]);
  });

  test("both skip same seq", () => {
    const { clock, j } = fj({ gapTimeoutMs: 3, bufSize: 2 });
    j.push("a", 2, "A2");
    j.push("b", 2, "B2");
    clock.advance(3);
    expect(j.drive().skipped).toEqual([
      { producer: "a", seq: 1 },
      { producer: "b", seq: 1 },
    ]);
    expect(j.poll()).toEqual([
      { seq: 1, values: {}, missing: ["a", "b"] },
      { seq: 2, values: { a: "A2", b: "B2" }, missing: [] },
    ]);
  });

  test("gap timer from first higher buffer", () => {
    const { clock, j } = fj({ gapTimeoutMs: 10 });
    clock.advance(2);
    j.push("a", 2, "A2");
    clock.advance(9);
    expect(j.drive().skipped).toEqual([]);
    clock.advance(1);
    expect(j.drive().skipped).toEqual([{ producer: "a", seq: 1 }]);
  });

  test("unknown producer and invalid seq", () => {
    const { j } = fj();
    expect(() => j.push("z", 1, "x")).toThrow(UnknownProducerError);
    expect(() => j.push("a", 0, "x")).toThrow(InvalidSeqError);
    expect(() => j.nextOf("z")).toThrow(UnknownProducerError);
  });

  test("poll maxn", () => {
    const { j } = fj();
    j.push("a", 1, "A1");
    j.push("b", 1, "B1");
    j.push("a", 2, "A2");
    j.push("b", 2, "B2");
    expect(j.poll(1)).toEqual([
      { seq: 1, values: { a: "A1", b: "B1" }, missing: [] },
    ]);
    expect(j.poll()).toHaveLength(1);
  });

  test("interleaved partial joins across producers", () => {
    const { clock, j } = fj({
      producers: ["p", "q", "r"],
      bufSize: 2,
      gapTimeoutMs: 4,
    });
    j.push("p", 1, "P1");
    j.push("q", 1, "Q1");
    // r missing
    j.push("r", 2, "R2");
    clock.advance(4);
    j.drive(); // skip r@1
    expect(j.poll()).toEqual([
      { seq: 1, values: { p: "P1", q: "Q1" }, missing: ["r"] },
    ]);
    j.push("p", 2, "P2");
    j.push("q", 2, "Q2");
    expect(j.poll()).toEqual([
      { seq: 2, values: { p: "P2", q: "Q2", r: "R2" }, missing: [] },
    ]);
  });

  test("bufferedOf and joinNext", () => {
    const { j } = fj();
    j.push("a", 3, "x");
    expect(j.bufferedOf("a")).toBe(1);
    expect(j.joinNext()).toBe(1);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("skip chain refreshes gapSince", () => {
    const { clock, j } = fj({ gapTimeoutMs: 5, bufSize: 3, producers: ["a", "b"] });
    j.push("a", 3, "A3");
    j.push("b", 1, "B1");
    j.push("b", 2, "B2");
    j.push("b", 3, "B3");
    clock.advance(5);
    expect(j.drive().skipped).toEqual([{ producer: "a", seq: 1 }]);
    // a next=2, still gapped (has 3), gapSince=5; join not ready for 1? a skipped@1, b value@1 → join 1
    expect(j.poll()[0]!.missing).toEqual(["a"]);
    clock.advance(5);
    expect(j.drive().skipped).toEqual([{ producer: "a", seq: 2 }]);
    expect(j.poll()).toEqual([
      { seq: 2, values: { b: "B2" }, missing: ["a"] },
      { seq: 3, values: { a: "A3", b: "B3" }, missing: [] },
    ]);
  });
});
