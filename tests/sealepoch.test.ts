import {
  VirtualClock,
  SealEpoch,
  InvalidConfigError,
  InvalidStreamError,
  InvalidAppendError,
  UnknownEpochError,
  InvalidSealError,
} from "../src/index.js";

function se(
  o: Partial<{ openTimeoutMs: number; maxRecordsPerEpoch: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new SealEpoch({
    clock,
    openTimeoutMs: o.openTimeoutMs ?? 10,
    maxRecordsPerEpoch: o.maxRecordsPerEpoch ?? 4,
  });
  return { clock, n };
}

describe("sealepoch hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new SealEpoch({ clock, openTimeoutMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("open append seal then read after watermark", () => {
    const { n } = se();
    const o = n.open("s");
    expect(o).toEqual({ epoch: 1, fence: 1 });
    expect(n.append("s", 1, 1, "a")).toBe(0);
    expect(n.append("s", 1, 1, "b")).toBe(1);
    expect(n.seal("s", 1, 1)).toBe(true);
    expect(n.isSealed("s", 1)).toBe(true);
    expect(() => n.read("s", 1)).toThrow(InvalidAppendError);
    n.advanceReadable("s", 1);
    expect(n.read("s", 1)).toEqual(["a", "b"]);
  });

  test("cannot double open; reopen after seal bumps epoch", () => {
    const { n } = se();
    n.open("s");
    expect(() => n.open("s")).toThrow(InvalidStreamError);
    n.seal("s", 1, 1);
    const o2 = n.open("s");
    expect(o2).toEqual({ epoch: 2, fence: 2 });
  });

  test("append to sealed rejected; wrong fence rejected", () => {
    const { n } = se();
    n.open("s");
    n.seal("s", 1, 1);
    expect(() => n.append("s", 1, 1, "x")).toThrow(InvalidAppendError);
    const o = n.open("s");
    expect(() => n.append("s", o.epoch, o.fence + 1, "x")).toThrow(
      InvalidAppendError,
    );
  });

  test("allowOpen reads open epoch; default blocks", () => {
    const { n } = se();
    n.open("s");
    n.append("s", 1, 1, 1);
    expect(() => n.read("s", 1)).toThrow(InvalidAppendError);
    expect(n.read("s", 1, { allowOpen: true })).toEqual([1]);
  });

  test("auto seal on timeout via drive; sorted multi-stream", () => {
    const { clock, n } = se({ openTimeoutMs: 5 });
    n.open("b");
    n.open("a");
    clock.advance(5);
    expect(n.drive().sealed).toEqual([
      { streamId: "a", epoch: 1 },
      { streamId: "b", epoch: 1 },
    ]);
    expect(n.openOf("a")).toBeUndefined();
    expect(n.isSealed("a", 1)).toBe(true);
  });

  test("max records; unknown epoch; empty stream id", () => {
    const { n } = se({ maxRecordsPerEpoch: 2 });
    n.open("s");
    n.append("s", 1, 1, 1);
    n.append("s", 1, 1, 2);
    expect(() => n.append("s", 1, 1, 3)).toThrow(InvalidAppendError);
    expect(() => n.append("s", 9, 1, 1)).toThrow(UnknownEpochError);
    expect(() => n.open("")).toThrow(InvalidStreamError);
  });

  test("seal mismatch; reseal same returns false", () => {
    const { n } = se();
    n.open("s");
    expect(() => n.seal("s", 1, 99)).toThrow(InvalidSealError);
    expect(n.seal("s", 1, 1)).toBe(true);
    expect(n.seal("s", 1, 1)).toBe(false);
    expect(() => n.seal("s", 3, 1)).toThrow(UnknownEpochError);
  });

  test("watermark is monotonic; unread sealed blocked", () => {
    const { n } = se();
    n.open("s");
    n.append("s", 1, 1, "e1");
    n.seal("s", 1, 1);
    n.open("s");
    n.append("s", 2, 2, "e2");
    n.seal("s", 2, 2);
    n.advanceReadable("s", 1);
    expect(n.read("s", 1)).toEqual(["e1"]);
    expect(() => n.read("s", 2)).toThrow(InvalidAppendError);
    n.advanceReadable("s", 0);
    expect(n.readableOf("s")).toBe(1);
    n.advanceReadable("s", 2);
    expect(n.read("s", 2)).toEqual(["e2"]);
  });

  test("unknown stream queries; clock negative", () => {
    const { clock, n } = se();
    expect(() => n.openOf("nope")).toThrow(InvalidStreamError);
    expect(() => n.readableOf("nope")).toThrow(InvalidStreamError);
    expect(() => clock.advance(-1)).toThrow();
    n.open("s");
    expect(n.recordsOf("s", 1)).toBe(0);
  });

  test("drive does not reseal already sealed", () => {
    const { clock, n } = se({ openTimeoutMs: 3 });
    n.open("s");
    clock.advance(3);
    expect(n.drive().sealed).toEqual([{ streamId: "s", epoch: 1 }]);
    expect(n.drive().sealed).toEqual([]);
  });

  test("append after auto-seal fails; new open works", () => {
    const { clock, n } = se({ openTimeoutMs: 2 });
    const o = n.open("s");
    clock.advance(2);
    n.drive();
    expect(() => n.append("s", o.epoch, o.fence, "x")).toThrow(
      InvalidAppendError,
    );
    const o2 = n.open("s");
    expect(n.append("s", o2.epoch, o2.fence, "y")).toBe(0);
  });

  test("independent streams fences global", () => {
    const { n } = se();
    const a = n.open("a");
    const b = n.open("b");
    expect(a.fence).toBe(1);
    expect(b.fence).toBe(2);
    expect(a.epoch).toBe(1);
    expect(b.epoch).toBe(1);
  });

  test("allowOpen falsey values still block", () => {
    const { n } = se();
    n.open("s");
    n.append("s", 1, 1, "z");
    expect(() => n.read("s", 1, { allowOpen: false })).toThrow(
      InvalidAppendError,
    );
  });
});
