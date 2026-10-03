import { VirtualClock } from "../src/clock.js";
import {
  DuplicatePinError,
  DuplicateTxnError,
  InvalidConfigError,
  UnknownPinError,
} from "../src/errors.js";
import { EpochMVCC } from "../src/store.js";

function make(pinTtlMs: number | null = null) {
  const clock = new VirtualClock();
  const s = new EpochMVCC({ clock, pinTtlMs });
  return { clock, s };
}

describe("epochmvcc basic", () => {
  test("config and empty read", () => {
    const clock = new VirtualClock();
    expect(() => new EpochMVCC({ clock, pinTtlMs: 0 })).toThrow(InvalidConfigError);
    const { s } = make();
    expect(s.epoch()).toBe(0);
    expect(s.get("a")).toBeUndefined();
  });

  test("write commit read and delete", () => {
    const { s } = make();
    s.begin("t1");
    s.write("t1", "a", "1");
    expect(s.read("t1", "a")).toBe("1");
    expect(s.get("a")).toBeUndefined();
    expect(s.commit("t1")).toBe("ok");
    expect(s.epoch()).toBe(1);
    expect(s.get("a")).toBe("1");
    s.begin("t2");
    s.delete("t2", "a");
    expect(s.commit("t2")).toBe("ok");
    expect(s.get("a")).toBeUndefined();
    expect(s.versionCount("a")).toBe(2);
  });

  test("empty commit does not bump epoch", () => {
    const { s } = make();
    s.begin("e");
    expect(s.commit("e")).toBe("ok");
    expect(s.epoch()).toBe(0);
  });
});

describe("epochmvcc snapshot isolation and conflicts", () => {
  test("pin sees stable snapshot while latest moves", () => {
    const { s } = make();
    s.begin("t1");
    s.write("t1", "k", "v1");
    s.commit("t1");
    const e = s.pin("snap");
    expect(e).toBe(1);
    s.begin("t2");
    s.write("t2", "k", "v2");
    s.commit("t2");
    expect(s.get("k")).toBe("v2");
    expect(s.getPinned("snap", "k")).toBe("v1");
    expect(s.getAt(1, "k")).toBe("v1");
    expect(() => s.pin("snap")).toThrow(DuplicatePinError);
  });

  test("ww conflict when concurrent write commits first", () => {
    const { s } = make();
    s.begin("a");
    s.write("a", "k", "1");
    s.commit("a");
    s.begin("t1");
    s.begin("t2");
    s.write("t1", "k", "x");
    s.write("t2", "k", "y");
    expect(s.commit("t1")).toBe("ok");
    expect(s.commit("t2")).toBe("conflict");
    expect(s.get("k")).toBe("x");
    expect(s.hasTxn("t2")).toBe(false);
  });

  test("txn read uses readEpoch not latest", () => {
    const { s } = make();
    s.begin("w");
    s.write("w", "k", "old");
    s.commit("w");
    s.begin("r");
    s.begin("w2");
    s.write("w2", "k", "new");
    s.commit("w2");
    expect(s.read("r", "k")).toBe("old");
    expect(s.get("k")).toBe("new");
  });

  test("duplicate txn and unknown pin", () => {
    const { s } = make();
    s.begin("t");
    expect(() => s.begin("t")).toThrow(DuplicateTxnError);
    expect(() => s.getPinned("no", "k")).toThrow(UnknownPinError);
  });
});

describe("epochmvcc gc and pin ttl", () => {
  test("gc retains versions needed by pins only", () => {
    const { s } = make();
    s.begin("t1");
    s.write("t1", "k", "1");
    s.commit("t1");
    s.pin("p");
    s.begin("t2");
    s.write("t2", "k", "2");
    s.commit("t2");
    s.begin("t3");
    s.write("t3", "k", "3");
    s.commit("t3");
    expect(s.versionCount("k")).toBe(3);
    expect(s.gc()).toBe(1); // epoch1 kept for pin, epoch2 obsolete vs epoch3, epoch3 kept
    expect(s.versionCount("k")).toBe(2);
    expect(s.getPinned("p", "k")).toBe("1");
    s.unpin("p");
    expect(s.gc()).toBe(1);
    expect(s.versionCount("k")).toBe(1);
    expect(s.get("k")).toBe("3");
  });

  test("drive expires pins by ttl then gc can reclaim", () => {
    const { clock, s } = make(50);
    s.begin("t1");
    s.write("t1", "a", "1");
    s.commit("t1");
    s.pin("old");
    s.begin("t2");
    s.write("t2", "a", "2");
    s.commit("t2");
    clock.advance(49);
    expect(s.drive()).toEqual([]);
    clock.advance(1);
    expect(s.drive()).toEqual(["old"]);
    expect(s.pinnedIds()).toEqual([]);
    expect(s.gc()).toBe(1);
    expect(s.get("a")).toBe("2");
  });

  test("tombstone visibility and conflict on delete race", () => {
    const { s } = make();
    s.begin("t1");
    s.write("t1", "k", "v");
    s.commit("t1");
    s.begin("d");
    s.begin("w");
    s.delete("d", "k");
    s.write("w", "k", "v2");
    expect(s.commit("d")).toBe("ok");
    expect(s.get("k")).toBeUndefined();
    expect(s.commit("w")).toBe("conflict");
  });

  test("abort and multi-key commit atomic epoch", () => {
    const { s } = make();
    s.begin("t");
    s.write("t", "a", "1");
    s.write("t", "b", "2");
    expect(s.abort("t")).toBe(true);
    expect(s.abort("t")).toBe(false);
    s.begin("u");
    s.write("u", "a", "1");
    s.write("u", "b", "2");
    expect(s.commit("u")).toBe("ok");
    expect(s.epoch()).toBe(1);
    expect(s.get("a")).toBe("1");
    expect(s.get("b")).toBe("2");
  });
});
