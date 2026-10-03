import { VirtualClock } from "../src/clock.js";
import {
  DuplicateLaneError,
  InvalidConfigError,
  LimitError,
  ReadOnlyError,
  UnknownLaneError,
} from "../src/errors.js";
import { SnapLane } from "../src/snaplane.js";

function make(maxSnaps = 4) {
  const clock = new VirtualClock();
  const s = new SnapLane({ clock, maxSnaps });
  return { clock, s };
}

describe("snaplane base", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new SnapLane({ clock, maxSnaps: 0 })).toThrow(InvalidConfigError);
  });

  test("head put get del", () => {
    const { s } = make();
    s.put("head", "a", "1");
    expect(s.get("head", "a")).toBe("1");
    expect(s.del("head", "a")).toBe(true);
    expect(s.get("head", "a")).toBeUndefined();
    expect(s.del("head", "a")).toBe(false);
  });

  test("readonly and unknown", () => {
    const { s } = make();
    s.put("head", "k", "v");
    s.snapshot("s1");
    expect(s.isReadonly("s1")).toBe(true);
    expect(() => s.put("s1", "k", "x")).toThrow(ReadOnlyError);
    expect(() => s.get("nope", "k")).toThrow(UnknownLaneError);
  });
});

describe("snaplane boundaries", () => {
  test("snapshot isolation from later head writes", () => {
    const { s } = make();
    s.put("head", "k", "old");
    s.snapshot("snap");
    s.put("head", "k", "new");
    expect(s.get("snap", "k")).toBe("old");
    expect(s.get("head", "k")).toBe("new");
    s.del("head", "k");
    expect(s.get("snap", "k")).toBe("old");
  });

  test("branch is independent cow lane", () => {
    const { s } = make();
    s.put("head", "x", "1");
    s.snapshot("base");
    s.branch("base", "br");
    expect(s.isReadonly("br")).toBe(false);
    s.put("br", "x", "2");
    s.put("head", "x", "3");
    expect(s.get("base", "x")).toBe("1");
    expect(s.get("br", "x")).toBe("2");
    expect(s.get("head", "x")).toBe("3");
  });

  test("ttl boundary now==deadline drops; branch survives", () => {
    const { clock, s } = make();
    s.put("head", "a", "1");
    s.snapshot("t1", 20);
    s.snapshot("t2", 40);
    s.branch("t1", "alive");
    clock.advance(20);
    expect(s.drive()).toEqual(["t1"]);
    expect(s.lanes()).toEqual(["alive", "head", "t2"]);
    expect(s.get("alive", "a")).toBe("1");
    clock.advance(20);
    expect(s.drive()).toEqual(["t2"]);
  });

  test("drop releases without breaking siblings; maxSnaps", () => {
    const { s } = make(2);
    s.put("head", "k", "v");
    s.snapshot("s1");
    s.snapshot("s2");
    expect(() => s.snapshot("s3")).toThrow(LimitError);
    expect(() => s.snapshot("s1")).toThrow(DuplicateLaneError);
    s.drop("s1");
    expect(s.get("s2", "k")).toBe("v");
    s.snapshot("s3");
    s.put("head", "k", "v2");
    expect(s.get("s2", "k")).toBe("v");
    expect(s.get("s3", "k")).toBe("v");
  });

  test("shared unchanged keys survive overwrite and gc path", () => {
    const { s } = make();
    s.put("head", "keep", "K");
    s.put("head", "mut", "M1");
    s.snapshot("s");
    s.branch("s", "b");
    s.put("b", "mut", "M2");
    s.drop("s");
    expect(s.get("b", "keep")).toBe("K");
    expect(s.get("b", "mut")).toBe("M2");
    expect(s.get("head", "mut")).toBe("M1");
  });
});
