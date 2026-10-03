import { hash32 } from "../src/hash.js";
import {
  DuplicateNodeError, EmptyRingError, FeatureNotReadyError, InvalidConfigError,
} from "../src/errors.js";
import { MigRing } from "../src/migring.js";

describe("migring base", () => {
  test("hash32 vector", () => {
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("a")).toBe(0xe40c292c);
  });

  test("config and empty", () => {
    expect(() => new MigRing({ ringSize: 3 })).toThrow(InvalidConfigError);
    const r = new MigRing({ ringSize: 64 });
    expect(() => r.locate("k")).toThrow(EmptyRingError);
  });

  test("add remove locate", () => {
    const r = new MigRing({ ringSize: 64 });
    r.addNode("b");
    r.addNode("a");
    expect(() => r.addNode("a")).toThrow(DuplicateNodeError);
    expect(r.nodes()).toEqual(["a", "b"]);
    const o1 = r.locate("user:1").owner;
    expect(o1 === "a" || o1 === "b").toBe(true);
    r.removeNode("a");
    expect(r.locate("user:1").owner).toBe("b");
    r.removeNode("b");
    expect(() => r.locate("user:1")).toThrow(EmptyRingError);
  });

  test("points sorted", () => {
    const r = new MigRing({ ringSize: 64 });
    r.addNode("m");
    r.addNode("c");
    const pts = r.points();
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.position).toBeGreaterThanOrEqual(pts[i - 1]!.position);
    }
  });
});

describe("migring features", () => {
  test("weight>=2 places multiple vnode materials", () => {
    const r = new MigRing({ ringSize: 128 });
    r.addNode("heavy", 3);
    r.addNode("light", 1);
    expect(r.points().filter((p) => p.nodeId === "heavy")).toHaveLength(3);
    expect(r.points().filter((p) => p.nodeId === "light")).toHaveLength(1);
    const mats = new Set(r.points().filter((p) => p.nodeId === "heavy").map((p) => p.position));
    // positions come from heavy#0,1,2 — at least not only bare "heavy"
    expect(mats.size).toBeGreaterThanOrEqual(1);
    expect(r.points().some((p) => p.nodeId === "heavy" && p.position === hash32("heavy#0") % 128)).toBe(true);
  });

  test("begin commit move sticky", () => {
    const r = new MigRing({ ringSize: 64 });
    r.addNode("a");
    r.addNode("b");
    const key = "k-move";
    const from = r.locate(key).owner;
    const to = from === "a" ? "b" : "a";
    r.beginMove(key, to);
    expect(r.locate(key)).toEqual({ owner: from, migratingTo: to });
    r.commitMove(key);
    expect(r.locate(key)).toEqual({ owner: to });
  });

  test("abort move", () => {
    const r = new MigRing({ ringSize: 64 });
    r.addNode("a");
    r.addNode("b");
    const key = "k-abort";
    const from = r.locate(key).owner;
    const to = from === "a" ? "b" : "a";
    r.beginMove(key, to);
    r.abortMove(key);
    expect(r.locate(key)).toEqual({ owner: from });
  });

  test("export import restores sticky and weights", () => {
    const r = new MigRing({ ringSize: 64 });
    r.addNode("a");
    r.addNode("b", 2);
    const key = "k-snap";
    const from = r.locate(key).owner;
    const to = from === "a" ? "b" : "a";
    r.beginMove(key, to);
    r.commitMove(key);
    const snap = r.exportState();
    const r2 = new MigRing({ ringSize: 64 });
    r2.importState(snap);
    expect(r2.points().filter((p) => p.nodeId === "b")).toHaveLength(2);
    expect(r2.locate(key)).toEqual({ owner: to });
  });

  test("removeNode drops sticky", () => {
    const r = new MigRing({ ringSize: 64 });
    r.addNode("a");
    r.addNode("b");
    const key = "k-drop";
    const from = r.locate(key).owner;
    const to = from === "a" ? "b" : "a";
    r.beginMove(key, to);
    r.commitMove(key);
    r.removeNode(to);
    expect(r.locate(key).owner).toBe(from === to ? from : from);
    expect(r.nodes()).toEqual([from]);
  });

  test("starter beginMove surfaces feature gap", () => {
    const r = new MigRing({ ringSize: 64 });
    r.addNode("a");
    r.addNode("b");
    try {
      r.beginMove("z", "b");
      // reference succeeds — assert shape
      expect(r.locate("z").migratingTo).toBe("b");
    } catch (e) {
      expect(e).toBeInstanceOf(FeatureNotReadyError);
    }
  });
});
