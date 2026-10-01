import {
  ConsistentRing,
  ExactNodes,
  RingError,
  fnv1a32,
  fnv32,
  vnodePositionsForNode,
} from "../src/index.js";

function fillRing(
  vnodeCount: number,
  seed: number,
  nodes: string[],
): ConsistentRing {
  const ring = new ConsistentRing(vnodeCount, seed);
  for (const id of nodes) ring.addNode(id);
  return ring;
}

describe("consist base ExactNodes", () => {
  test("add and list returns sorted ids", () => {
    const en = new ExactNodes();
    en.add("z");
    en.add("a");
    en.add("m");
    expect(en.list()).toEqual(["a", "m", "z"]);
  });

  test("remove drops node id", () => {
    const en = new ExactNodes();
    en.add("x");
    en.add("y");
    en.remove("x");
    expect(en.list()).toEqual(["y"]);
    expect(en.size()).toBe(1);
  });

  test("size tracks distinct nodes", () => {
    const en = new ExactNodes();
    en.add("alpha");
    en.add("alpha");
    en.add("beta");
    expect(en.size()).toBe(2);
  });

  test("pickExact indexes sorted list via fnv1a32 mod size locked", () => {
    const en = new ExactNodes();
    en.add("alpha");
    en.add("beta");
    en.add("gamma");
    expect(en.pickExact("user-key")).toBe("beta");
  });

  test("pickExact returns null when empty", () => {
    const en = new ExactNodes();
    expect(en.pickExact("k")).toBeNull();
  });

  test("pickExact is deterministic for same key", () => {
    const en = new ExactNodes();
    en.add("n1");
    en.add("n2");
    en.add("n3");
    expect(en.pickExact("session")).toBe(en.pickExact("session"));
  });

  test("clear resets node set", () => {
    const en = new ExactNodes();
    en.add("keep?");
    en.clear();
    expect(en.size()).toBe(0);
    expect(en.list()).toEqual([]);
  });
});

describe("consist feature hell", () => {
  test("fnv1a32 locked empty seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
  });

  test("fnv32 locked seed 42 vnode salt strings", () => {
    expect(fnv32(42, "a#0")).toBe(2439876833);
    expect(fnv32(42, "a#1")).toBe(2423099214);
    expect(fnv32(42, "a#2")).toBe(2406321595);
  });

  test("vnodePositionsForNode locked node a vnodeCount 3 seed 42", () => {
    expect(vnodePositionsForNode("a", 3, 42)).toEqual([
      2406321595, 2423099214, 2439876833,
    ]);
  });

  test("ConsistentRing rejects invalid vnodeCount", () => {
    expect(() => new ConsistentRing(0, 0)).toThrow(RingError);
    expect(() => new ConsistentRing(257, 0)).toThrow(RingError);
    expect(() => new ConsistentRing(2.5, 0)).toThrow(RingError);
  });

  test("ringSnapshot locked ab vnodeCount 2 seed 7", () => {
    const ring = fillRing(2, 7, ["a", "b"]);
    expect(ring.ringSnapshot()).toEqual([
      { pos: 106904282, id: "a" },
      { pos: 123681901, id: "a" },
      { pos: 3021005528, id: "b" },
      { pos: 3037783147, id: "b" },
    ]);
  });

  test("addNode duplicate throws RingError", () => {
    const ring = new ConsistentRing(3, 0);
    ring.addNode("x");
    expect(() => ring.addNode("x")).toThrow(RingError);
  });

  test("assign uses clockwise search locked session seed 7", () => {
    const ring = fillRing(2, 7, ["a", "b"]);
    expect(ring.assign("session")).toBe("b");
  });

  test("assign returns null when ring empty", () => {
    const ring = new ConsistentRing(4, 0);
    expect(ring.assign("k")).toBeNull();
  });

  test("assign wraps to first vnode when hash exceeds all positions", () => {
    const ring = fillRing(2, 7, ["a", "b"]);
    expect(fnv32(7, "wrap-key")).toBe(3106664472);
    expect(ring.assign("wrap-key")).toBe("a");
  });

  test("successors includes primary and next distinct nodes k equals 3", () => {
    const ring = fillRing(3, 42, ["a", "b", "c"]);
    expect(ring.successors("route", 3)).toEqual(["a", "b", "c"]);
  });

  test("successors returns all distinct when k exceeds node count", () => {
    const ring = fillRing(2, 7, ["a", "b"]);
    expect(ring.successors("session", 5)).toEqual(["b", "a"]);
  });

  test("successors k less than 1 throws RingError", () => {
    const ring = fillRing(2, 0, ["a"]);
    expect(() => ring.successors("k", 0)).toThrow(RingError);
    expect(() => ring.successors("k", -1)).toThrow(RingError);
  });

  test("removeNode rebuilds ring and changes assign", () => {
    const ring = fillRing(2, 7, ["a", "b", "c"]);
    const before = ring.assign("session");
    ring.removeNode("b");
    expect(ring.nodes()).toEqual(["a", "c"]);
    expect(ring.assign("session")).not.toBe(before);
  });

  test("vnodePositions returns sorted positions for node", () => {
    const ring = fillRing(3, 42, ["a", "b"]);
    expect(ring.vnodePositions("a")).toEqual([
      2406321595, 2423099214, 2439876833,
    ]);
    expect(ring.vnodePositions("missing")).toEqual([]);
  });

  test("ringSnapshot returns a copy not shared reference", () => {
    const ring = fillRing(2, 7, ["a"]);
    const snap = ring.ringSnapshot();
    snap[0]!.id = "mutated";
    expect(ring.ringSnapshot()[0]!.id).toBe("a");
  });

  test("freeze blocks addNode and removeNode", () => {
    const ring = fillRing(2, 0, ["a"]);
    ring.freeze();
    expect(() => ring.addNode("b")).toThrow(RingError);
    expect(() => ring.removeNode("a")).toThrow(RingError);
  });

  test("assign and successors still work when frozen", () => {
    const ring = fillRing(2, 7, ["a", "b"]);
    const primary = ring.assign("session");
    const succ = ring.successors("session", 2);
    ring.freeze();
    expect(ring.assign("session")).toBe(primary);
    expect(ring.successors("session", 2)).toEqual(succ);
  });

  test("exportState and fromState roundtrip", () => {
    const ring = fillRing(3, 42, ["east", "west", "north"]);
    const state = ring.exportState();
    const restored = ConsistentRing.fromState(state);
    expect(restored.exportState()).toEqual(state);
    expect(restored.ringSnapshot()).toEqual(ring.ringSnapshot());
    expect(restored.assign("route")).toBe(ring.assign("route"));
  });

  test("stats reflects vnodeCount seed frozen nodeCount ringSize", () => {
    const ring = fillRing(2, 7, ["a", "b"]);
    ring.freeze();
    expect(ring.stats()).toEqual({
      vnodeCount: 2,
      seed: 7,
      frozen: true,
      nodeCount: 2,
      ringSize: 4,
    });
  });
});
