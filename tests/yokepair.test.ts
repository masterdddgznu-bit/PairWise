import { VirtualClock, YokePair, YokePairError } from "../src";

const code = (fn: () => unknown, want: string) => {
  try {
    fn();
    throw new Error("NO_ERROR");
  } catch (error) {
    expect(error).toBeInstanceOf(YokePairError);
    expect((error as YokePairError).code).toBe(want);
  }
};

const setup = (opts?: {
  maxBeasts?: number;
  maxYokes?: number;
  maxWork?: number;
  leaseTtl?: number;
  initialRest?: number;
}) => {
  const clock = new VirtualClock();
  const pair = new YokePair({ clock, ...opts });
  return { clock, pair };
};

const seed = (opts?: { initialRest?: number; leaseTtl?: number }) => {
  const { clock, pair } = setup({
    initialRest: opts?.initialRest ?? 2,
    leaseTtl: opts?.leaseTtl
  });
  pair.openYoke("Y", 40, 12);
  pair.register("wide", { draft: 18, readyAt: 0 });
  pair.register("mid", { draft: 10, readyAt: 0 });
  pair.register("near", { draft: 11, readyAt: 0 });
  return { clock, pair };
};

const pullOnce = (pair: YokePair, a: string, b: string) => {
  pair.hitch(a, b, "Y");
  const job = pair.requestJob("Y", "pull");
  const claimed = pair.claim("op")!;
  pair.pull(job.id, "op", claimed.fence);
  return pair.unhitch(a, b);
};

describe("yokepair", () => {
  test("rejects invalid config", () => {
    const clock = new VirtualClock();
    code(() => new YokePair({ clock, maxBeasts: 0 }), "INVALID_MAXBEASTS");
    code(() => new YokePair({ clock, initialRest: -1 }), "INVALID_INITIALREST");
    expect(() => clock.advance(-1)).toThrow();
  });

  test("registers beasts and opens yokes", () => {
    const { pair } = seed();
    expect(pair.size()).toBe(3);
    expect(pair.ids()).toEqual(["wide", "mid", "near"]);
    expect(pair.yokes()[0]!.fill).toBe(0);
    expect(pair.yokes()[0]!.cap).toBe(40);
    expect(pair.register("wide", { draft: 16, readyAt: 1 })).toEqual({ status: "updated" });
  });

  test("rejects illegal fields and capacity", () => {
    const { pair } = setup({ maxBeasts: 1, maxYokes: 1 });
    pair.openYoke("Y", 20, 8);
    code(() => pair.register("", { draft: 4, readyAt: 0 }), "INVALID_ID");
    code(() => pair.register("a", { draft: 0, readyAt: 0 }), "INVALID_DRAFT");
    expect(pair.register("a", { draft: 4, readyAt: 0 }).status).toBe("accepted");
    code(() => pair.register("b", { draft: 4, readyAt: 0 }), "CAPACITY");
    code(() => pair.openYoke("R", 20, 8), "YOKE_CAPACITY");
    code(() => pair.openYoke("Y", 20, 8), "YOKE_EXISTS");
    code(() => pair.hitch("a", "a", "Y"), "SAME_BEAST");
  });

  test("peeks the closest remaining draft pair", () => {
    const { pair } = seed();
    expect(pair.peekPair("Y")).toEqual({ a: "mid", b: "near" });
    expect(pair.hitch("near", "mid", "Y").a).toBe("mid");
  });

  test("peekPair does not mutate and skips unreadiness", () => {
    const { clock, pair } = setup();
    pair.openYoke("Y", 40, 12);
    pair.register("late", { draft: 8, readyAt: 6 });
    pair.register("now", { draft: 8, readyAt: 0 });
    pair.register("soon", { draft: 9, readyAt: 6 });
    expect(pair.peekPair("Y")).toBeNull();
    expect(pair.yokes()[0]!.a).toBeUndefined();
    clock.advance(6);
    expect(pair.peekPair("Y")).toEqual({ a: "late", b: "now" });
  });

  test("pull fills the yoke and unhitch requires a finished pull", () => {
    const { pair } = seed();
    pair.hitch("mid", "near", "Y");
    code(() => pair.unhitch("mid", "near"), "NOT_PULLED");
    const job = pair.requestJob("Y", "pull");
    const claimed = pair.claim("op")!;
    expect(pair.pull(job.id, "op", claimed.fence).fill).toBe(21);
    expect(pair.unhitch("mid", "near").a).toBeUndefined();
  });

  test("oversized pairs cannot hitch", () => {
    const { pair } = setup();
    pair.openYoke("Y", 12, 8);
    pair.register("a", { draft: 8, readyAt: 0 });
    pair.register("b", { draft: 8, readyAt: 0 });
    code(() => pair.hitch("a", "b", "Y"), "LOW_ROOM");
  });

  test("defensive copies protect snapshot lists", () => {
    const { pair } = seed();
    pair.hitch("mid", "near", "Y");
    const snap = pair.snapshot();
    snap.yokes[0]!.fill = 1;
    snap.beasts[0]!.draft = 1;
    snap.yokes[0]!.a = "ghost";
    expect(pair.yokes()[0]!.fill).toBe(0);
    expect(pair.snapshot().beasts.find(x => x.id === "mid")!.draft).toBe(10);
    const listed = pair.yokes();
    listed[0]!.cap = 1;
    expect(pair.snapshot().yokes[0]!.cap).toBe(40);
  });

  test("INTERLEAVED an earlier mismatched pair is not head while a closer pair fits", () => {
    const { pair } = seed();
    expect(pair.peekPair("Y")).toEqual({ a: "mid", b: "near" });
    code(() => pair.hitch("wide", "mid", "Y"), "NOT_HEAD");
    expect(pair.yokes()[0]!.a).toBeUndefined();
    expect(pair.hitch("mid", "near", "Y").b).toBe("near");
  });

  test("INTERLEAVED lease expiry stays assigned until drive and stale fence rolls back", () => {
    const { clock, pair } = seed({ leaseTtl: 3 });
    pair.hitch("mid", "near", "Y");
    const job = pair.requestJob("Y", "pull");
    const claimed = pair.claim("op")!;
    clock.advance(3);
    code(() => pair.pull(job.id, "op", claimed.fence), "LEASE_EXPIRED");
    expect(pair.yokes()[0]!.fill).toBe(0);
    expect(pair.work()[0]!.status).toBe("assigned");
    expect(pair.drive().expired).toEqual([job.id]);
    const again = pair.claim("op")!;
    code(() => pair.pull(job.id, "op", claimed.fence), "STALE_FENCE");
    expect(pair.pull(job.id, "op", again.fence).fill).toBe(21);
  });

  test("INTERLEAVED frozen occupant blocks pull without filling", () => {
    const { pair } = seed();
    pair.hitch("mid", "near", "Y");
    pair.freeze("mid");
    const job = pair.requestJob("Y", "pull");
    const claimed = pair.claim("op")!;
    code(() => pair.pull(job.id, "op", claimed.fence), "PULL_BLOCKED");
    expect(pair.yokes()[0]!.fill).toBe(0);
    expect(pair.work()[0]!.status).toBe("assigned");
    pair.unfreeze("mid");
    expect(pair.pull(job.id, "op", claimed.fence).fill).toBe(21);
  });

  test("INTERLEAVED freeze skips a close beast so a wider pair may hitch", () => {
    const { pair } = seed();
    pair.freeze("mid");
    expect(pair.peekPair("Y")).toEqual({ a: "near", b: "wide" });
    code(() => pair.hitch("mid", "near", "Y"), "FROZEN");
    expect(pair.hitch("wide", "near", "Y").a).toBe("near");
  });

  test("INTERLEAVED rest refuses a busy yoke then frees strain", () => {
    const { pair } = seed({ initialRest: 2 });
    pair.hitch("mid", "near", "Y");
    const r0 = pair.requestJob("Y", "rest");
    const q = pair.requestJob("Y", "pull");
    const cq = pair.claim("op", "pull")!;
    expect(cq.id).toBe(q.id);
    const c0 = pair.claim("op", "rest")!;
    expect(c0.id).toBe(r0.id);
    code(() => pair.rest(r0.id, "op", c0.fence), "YOKE_BUSY");
    expect(pair.restCredit()).toBe(2);
    expect(pair.pull(q.id, "op", cq.fence).fill).toBe(21);
    pair.unhitch("mid", "near");
    expect(pair.rest(r0.id, "op", c0.fence).fill).toBe(9);
  });

  test("INTERLEAVED cancel frees capacity but on-yoke cancel and rewrite fail", () => {
    const { pair } = setup({ maxBeasts: 3, initialRest: 1 });
    pair.openYoke("Y", 40, 12);
    pair.register("a", { draft: 8, readyAt: 0 });
    pair.register("b", { draft: 8, readyAt: 0 });
    pair.register("c", { draft: 9, readyAt: 0 });
    pair.hitch("a", "b", "Y");
    code(() => pair.cancel("a"), "IN_YOKE");
    code(() => pair.register("a", { draft: 9, readyAt: 0 }), "IN_YOKE");
    expect(pair.cancel("c")).toBe(true);
    expect(pair.register("d", { draft: 8, readyAt: 0 }).status).toBe("accepted");
    expect(pair.ids()).toEqual(["a", "b", "d"]);
  });

  test("INTERLEAVED remaining strain hides the wider pair until rest", () => {
    const { pair } = setup({ initialRest: 2 });
    pair.openYoke("Y", 40, 12);
    pair.register("wide", { draft: 18, readyAt: 0 });
    pair.register("mid", { draft: 10, readyAt: 0 });
    pair.register("near", { draft: 11, readyAt: 0 });
    pullOnce(pair, "mid", "near");
    pair.register("ox", { draft: 18, readyAt: 0 });
    expect(pair.peekPair("Y")).toBeNull();
    code(() => pair.hitch("wide", "ox", "Y"), "LOW_ROOM");
    const first = pair.requestJob("Y", "rest");
    const c1 = pair.claim("op")!;
    expect(pair.rest(first.id, "op", c1.fence).fill).toBe(9);
    code(() => pair.hitch("wide", "ox", "Y"), "LOW_ROOM");
    const second = pair.requestJob("Y", "rest");
    const c2 = pair.claim("op")!;
    expect(pair.rest(second.id, "op", c2.fence).fill).toBe(0);
    expect(pair.hitch("wide", "ox", "Y").b).toBe("wide");
  });

  test("not ready beast cannot hitch before the clock reaches readyAt", () => {
    const { clock, pair } = setup();
    pair.openYoke("Y", 40, 12);
    pair.register("later", { draft: 8, readyAt: 4 });
    pair.register("now", { draft: 8, readyAt: 0 });
    code(() => pair.hitch("later", "now", "Y"), "NOT_READY");
    clock.advance(4);
    expect(pair.hitch("later", "now", "Y").a).toBe("later");
  });

  test("wrong worker and wrong kind roll back fill", () => {
    const { pair } = seed();
    pair.hitch("mid", "near", "Y");
    const job = pair.requestJob("Y", "pull");
    const claimed = pair.claim("op")!;
    code(() => pair.pull(job.id, "other", claimed.fence), "STALE_FENCE");
    code(() => pair.rest(job.id, "op", claimed.fence), "WRONG_KIND");
    expect(pair.yokes()[0]!.fill).toBe(0);
    expect(pair.pull(job.id, "op", claimed.fence).fill).toBe(21);
  });

  test("rest without credit fails atomically", () => {
    const { pair } = seed({ initialRest: 0 });
    pullOnce(pair, "mid", "near");
    const job = pair.requestJob("Y", "rest");
    const claimed = pair.claim("op")!;
    code(() => pair.rest(job.id, "op", claimed.fence), "NO_REST");
    expect(pair.yokes()[0]!.fill).toBe(21);
    pair.grantRest(1);
    expect(pair.rest(job.id, "op", claimed.fence).fill).toBe(9);
  });
});
