import {
  ConfigError,
  HintCluster,
  HintStore,
  VirtualClock,
} from "../src/index.js";

const NODES = ["a", "b", "c", "d", "e"];

function cluster(n = 3, r = 2, w = 2) {
  const clock = new VirtualClock();
  return new HintCluster(clock, NODES, n, r, w);
}

describe("hintoff base", () => {
  test("put get", () => {
    const s = new HintStore();
    s.put("a", "1");
    expect(s.get("a")).toBe("1");
  });

  test("delete has size", () => {
    const s = new HintStore();
    s.put("a", "1");
    expect(s.has("a")).toBe(true);
    expect(s.delete("a")).toBe(true);
    expect(s.size()).toBe(0);
  });

  test("keys sorted", () => {
    const s = new HintStore();
    s.put("c", "3");
    s.put("a", "1");
    s.put("b", "2");
    expect(s.keys()).toEqual(["a", "b", "c"]);
  });

  test("overwrite", () => {
    const s = new HintStore();
    s.put("a", "1");
    s.put("a", "2");
    expect(s.get("a")).toBe("2");
    expect(s.size()).toBe(1);
  });

  test("independent keys", () => {
    const s = new HintStore();
    s.put("a", "1");
    s.put("b", "2");
    s.delete("a");
    expect(s.get("b")).toBe("2");
  });

  test("delete missing", () => {
    const s = new HintStore();
    expect(s.delete("x")).toBe(false);
  });
});

describe("hintoff feature hell", () => {
  test("ConfigError on bad n r w", () => {
    const clock = new VirtualClock();
    expect(() => new HintCluster(clock, NODES, 6, 2, 2)).toThrow(ConfigError);
    expect(() => new HintCluster(clock, NODES, 3, 0, 2)).toThrow(ConfigError);
    expect(() => new HintCluster(clock, NODES, 3, 2, 4)).toThrow(ConfigError);
  });

  test("preference list stable for key", () => {
    const c = cluster();
    const p1 = c.preferenceList("user:42");
    const p2 = c.preferenceList("user:42");
    expect(p1).toEqual(p2);
    expect(p1).toHaveLength(3);
    expect(new Set(p1).size).toBe(3);
  });

  test("put succeeds when W preference nodes available", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("k1");
    const r = c.put("k1", "v1", pref);
    expect(r.ok).toBe(true);
    expect(r.written).toEqual(pref.filter((id) => pref.includes(id)));
    expect(r.written.length).toBeGreaterThanOrEqual(2);
    for (const id of r.written) {
      expect(c.nodeGet(id, "k1")).toBe("v1");
    }
  });

  test("put fails when fewer than W preference nodes available", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("k2");
    const onlyOne = [pref[0]!];
    const r = c.put("k2", "v", onlyOne);
    expect(r.ok).toBe(false);
    expect(r.written).toEqual(onlyOne);
  });

  test("hints created for down preference nodes", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("k3");
    const avail = [pref[0]!, pref[2]!];
    const down = pref[1]!;
    const r = c.put("k3", "hv", avail);
    expect(r.hinted.some((h) => h.target === down)).toBe(true);
    const holder = r.hinted.find((h) => h.target === down)!.holder;
    const hints = c.hintsFor(holder);
    expect(hints.some((h) => h.target === down && h.key === "k3")).toBe(true);
  });

  test("hintsFor sorted by target then key", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("alpha");
    const avail = [pref[0]!];
    c.put("alpha", "1", avail);
    c.put("beta", "2", avail);
    const holder = pref[0]!;
    const hints = c.hintsFor(holder);
    const keys = hints.map((h) => `${h.target}:${h.key}`);
    expect([...keys].sort()).toEqual(keys);
  });

  test("nodeGet ignores hints on holder", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("ghost");
    const avail = [pref[0]!];
    c.put("ghost", "secret", avail);
    expect(c.nodeGet(pref[0]!, "ghost")).toBe("secret");
    const down = pref[1]!;
    expect(c.nodeGet(pref[0]!, down)).toBeUndefined();
  });

  test("deliverHints moves hints to target primary", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("del");
    const avail = [pref[0]!, pref[2]!];
    const down = pref[1]!;
    const r = c.put("del", "payload", avail);
    const holder = r.hinted.find((h) => h.target === down)!.holder;
    expect(c.nodeGet(down, "del")).toBeUndefined();
    const n = c.deliverHints(holder, down);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(c.nodeGet(down, "del")).toBe("payload");
  });

  test("deliverHints LWW newer hint wins over older primary", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("lww");
    const target = pref[1]!;
    c.put("lww", "old", [pref[0]!, pref[1]!, pref[2]!]);
    const r2 = c.put("lww", "new", [pref[0]!, pref[2]!]);
    const holder = r2.hinted.find((h) => h.target === target)!.holder;
    c.deliverHints(holder, target);
    expect(c.nodeGet(target, "lww")).toBe("new");
  });

  test("get reads winning value from quorum", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("read1");
    c.put("read1", "val", pref);
    const g = c.get("read1", pref);
    expect(g.value).toBe("val");
    expect(g.repaired).toBe(0);
  });

  test("get read repair updates stale replica", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("repair");
    c.put("repair", "fresh", pref);
    const stale = pref[1]!;
    c.put("repair", "newer", [pref[0]!, pref[2]!]);
    const readers = [pref[0]!, stale];
    const g = c.get("repair", readers);
    expect(g.value).toBe("newer");
    expect(g.repaired).toBeGreaterThanOrEqual(1);
    expect(c.nodeGet(stale, "repair")).toBe("newer");
  });

  test("get undefined when no primary copies", () => {
    const c = cluster();
    const pref = c.preferenceList("missing");
    const g = c.get("missing", pref.slice(0, 2));
    expect(g.value).toBeUndefined();
    expect(g.repaired).toBe(0);
  });

  test("ok false still stores hints", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("partial");
    const r = c.put("partial", "x", [pref[0]!]);
    expect(r.ok).toBe(false);
    expect(r.hinted.length).toBeGreaterThan(0);
  });

  test("hash spreads keys across preference ring", () => {
    const c = cluster();
    const seen = new Set<string>();
    for (let i = 0; i < 24; i++) {
      seen.add(JSON.stringify(c.preferenceList(`probe-${i}`)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("get LWW picks higher counter among divergent reads", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("ver");
    c.put("ver", "first", [pref[0]!, pref[1]!]);
    c.put("ver", "second", [pref[0]!, pref[2]!]);
    const g = c.get("ver", [pref[0]!, pref[1]!, pref[2]!]);
    expect(g.value).toBe("second");
  });

  test("hints cleared from holder after deliver", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("clear");
    const down = pref[1]!;
    const r = c.put("clear", "z", [pref[0]!, pref[2]!]);
    const holder = r.hinted.find((h) => h.target === down)!.holder;
    c.deliverHints(holder, down);
    expect(c.hintsFor(holder).filter((h) => h.target === down)).toEqual([]);
  });

  test("written order follows preference list", () => {
    const c = cluster(3, 2, 2);
    const pref = c.preferenceList("ord");
    const r = c.put("ord", "1", pref);
    const writtenInPrefOrder = pref.filter((id) => r.written.includes(id));
    expect(r.written).toEqual(writtenInPrefOrder);
  });
});
