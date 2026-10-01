import {
  ExactRouter,
  RendezvousHash,
  RendezvousError,
  fnv1a32,
  fnv32ForNode,
  rendezvousScore,
} from "../src/index.js";

function fillHash(seed: number, nodes: { id: string; weight?: number }[]): RendezvousHash {
  const r = new RendezvousHash(seed);
  for (const n of nodes) r.addNode(n.id, n.weight ?? 1);
  return r;
}

describe("rendezvous base ExactRouter", () => {
  test("addNode and size track ids", () => {
    const router = new ExactRouter();
    router.addNode("alpha");
    router.addNode("beta");
    router.addNode("alpha");
    expect(router.size()).toBe(2);
  });

  test("nodes returns sorted ids", () => {
    const router = new ExactRouter();
    router.addNode("z");
    router.addNode("a");
    router.addNode("m");
    expect(router.nodes()).toEqual(["a", "m", "z"]);
  });

  test("removeNode drops id", () => {
    const router = new ExactRouter();
    router.addNode("x");
    router.addNode("y");
    router.removeNode("x");
    expect(router.nodes()).toEqual(["y"]);
    expect(router.size()).toBe(1);
  });

  test("routeExact picks lexicographically smallest id", () => {
    const router = new ExactRouter();
    router.addNode("node-b");
    router.addNode("node-a");
    router.addNode("node-c");
    expect(router.routeExact("any-key")).toBe("node-a");
  });

  test("routeExact returns null when empty", () => {
    const router = new ExactRouter();
    expect(router.routeExact("k")).toBeNull();
  });

  test("clear resets router", () => {
    const router = new ExactRouter();
    router.addNode("n1");
    router.clear();
    expect(router.size()).toBe(0);
    expect(router.nodes()).toEqual([]);
  });
});

describe("rendezvous feature hell", () => {
  test("fnv1a32 locked empty seed 0", () => {
    expect(fnv1a32("", 0)).toBe(2166136261);
  });

  test("fnv32ForNode locked seed 7 key user node n1", () => {
    expect(fnv32ForNode(7, "user", "n1")).toBe(2460911606);
  });

  test("rendezvousScore locked bigint seed 7 user n1 weight 2", () => {
    expect(rendezvousScore(7, "user", "n1", 2)).toBe(4921823212000n);
  });

  test("pick returns null when empty", () => {
    const r = new RendezvousHash(0);
    expect(r.pick("k")).toBeNull();
  });

  test("pick deterministic seed 0 key session locked", () => {
    const r = fillHash(0, [{ id: "n1" }, { id: "n2" }, { id: "n3" }]);
    expect(r.pick("session")).toBe("n2");
  });

  test("weighted pick favors heavier node locked", () => {
    const r = fillHash(42, [
      { id: "light", weight: 1 },
      { id: "heavy", weight: 50 },
    ]);
    expect(r.pick("route")).toBe("heavy");
  });

  test("pick selects max score with id tie-break rule locked", () => {
    const seed = 0;
    const key = "session";
    const r = fillHash(seed, [{ id: "n1" }, { id: "n2" }, { id: "n3" }]);
    const ranked = ["n1", "n2", "n3"]
      .map((id) => ({ id, s: rendezvousScore(seed, key, id, 1) }))
      .sort((a, b) => (a.s > b.s ? -1 : a.s < b.s ? 1 : a.id.localeCompare(b.id)));
    expect(r.pick(key)).toBe(ranked[0]!.id);
  });

  test("topK returns ordered top two locked", () => {
    const r = fillHash(0, [{ id: "n1" }, { id: "n2" }, { id: "n3" }]);
    expect(r.topK("session", 2)).toEqual(["n2", "n3"]);
  });

  test("topK k greater than size returns all ranked", () => {
    const r = fillHash(0, [{ id: "x" }, { id: "y" }]);
    expect(r.topK("k", 5)).toEqual(["y", "x"]);
  });

  test("topK k less than 1 throws RendezvousError", () => {
    const r = fillHash(0, [{ id: "a" }]);
    expect(() => r.topK("k", 0)).toThrow(RendezvousError);
    expect(() => r.topK("k", -1)).toThrow(RendezvousError);
  });

  test("invalid weight on addNode throws RendezvousError", () => {
    const r = new RendezvousHash(0);
    expect(() => r.addNode("bad", 0)).toThrow(RendezvousError);
    expect(() => r.addNode("bad2", -3)).toThrow(RendezvousError);
  });

  test("hasNode removeNode and nodeWeight", () => {
    const r = new RendezvousHash(1);
    r.addNode("a", 2.5);
    expect(r.hasNode("a")).toBe(true);
    expect(r.nodeWeight("a")).toBe(2.5);
    r.removeNode("a");
    expect(r.hasNode("a")).toBe(false);
    expect(() => r.nodeWeight("a")).toThrow(RendezvousError);
  });

  test("exportNodes and fromNodes roundtrip sorted", () => {
    const r = fillHash(5, [
      { id: "z", weight: 1 },
      { id: "a", weight: 3 },
    ]);
    const exported = r.exportNodes();
    expect(exported).toEqual([
      { id: "a", weight: 3 },
      { id: "z", weight: 1 },
    ]);
    const r2 = RendezvousHash.fromNodes(5, exported);
    expect(r2.exportNodes()).toEqual(exported);
    expect(r2.pick("x")).toBe(r.pick("x"));
  });

  test("freeze blocks add and remove", () => {
    const r = fillHash(0, [{ id: "n1" }]);
    r.freeze();
    expect(() => r.addNode("n2")).toThrow(RendezvousError);
    expect(() => r.removeNode("n1")).toThrow(RendezvousError);
  });

  test("pick and topK still work when frozen", () => {
    const r = fillHash(0, [{ id: "n1" }, { id: "n2" }]);
    const before = r.pick("session");
    r.freeze();
    expect(r.pick("session")).toBe(before);
    expect(r.topK("session", 2)).toEqual(["n2", "n1"]);
  });

  test("stats reflects seed frozen size totalWeight", () => {
    const r = fillHash(11, [
      { id: "a", weight: 2 },
      { id: "b", weight: 3 },
    ]);
    r.freeze();
    expect(r.stats()).toEqual({
      seed: 11,
      frozen: true,
      size: 2,
      totalWeight: 5,
    });
  });

  test("needsRebalance threshold locked", () => {
    const balanced = fillHash(0, [
      { id: "a", weight: 2 },
      { id: "b", weight: 2.5 },
    ]);
    expect(balanced.needsRebalance(1.5)).toBe(false);
    const skewed = fillHash(0, [
      { id: "a", weight: 1 },
      { id: "b", weight: 10 },
    ]);
    expect(skewed.needsRebalance(5)).toBe(true);
    expect(skewed.needsRebalance(20)).toBe(false);
    expect(new RendezvousHash(0).needsRebalance(2)).toBe(false);
  });

  test("topK full ordering locked seed 13 stream", () => {
    const r = fillHash(13, [
      { id: "east" },
      { id: "west" },
      { id: "north" },
      { id: "south" },
    ]);
    expect(r.topK("shard", 4)).toEqual(["south", "east", "north", "west"]);
  });

  test("RendezvousError has stable name", () => {
    expect(new RendezvousError().name).toBe("RendezvousError");
  });
});
