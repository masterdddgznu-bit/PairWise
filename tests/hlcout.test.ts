import {
  VirtualClock,
  Hlcout,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  StateError,
  UnknownError,
} from "../src/index.js";
import type { Hlc, HlcoutOptions, OutMsg } from "../src/index.js";

type Opts = {
  maxReplicas?: number;
  maxPending?: number;
  maxChk?: number;
};

function make(clock: VirtualClock, o: Opts = {}) {
  return new Hlcout({
    clock,
    maxReplicas: o.maxReplicas,
    maxPending: o.maxPending,
    maxChk: o.maxChk,
  });
}

function roundTrip(h: Hlcout, clock: VirtualClock, o: Opts = {}) {
  const opts: Omit<HlcoutOptions, "clock"> = {
    maxReplicas: o.maxReplicas,
    maxPending: o.maxPending,
    maxChk: o.maxChk,
  };
  return Hlcout.fromJournal(clock, opts, h.journal());
}

function hlc(pt: number, lc: number): Hlc {
  return { pt, lc };
}

describe("hlcout hell+", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new Hlcout({ clock, maxReplicas: 0 })).toThrow(InvalidConfigError);
    expect(() => new Hlcout({ clock, maxPending: -1 })).toThrow(InvalidConfigError);
    expect(() => new Hlcout({ clock, maxChk: 0 })).toThrow(InvalidConfigError);
    expect(() => new Hlcout({ clock: null as unknown as VirtualClock })).toThrow(
      InvalidConfigError,
    );
  });

  test("register and clockOf basics", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    expect(h.replicas()).toEqual(["a"]);
    expect(h.clockOf("a")).toEqual(hlc(0, 0));
    expect(() => h.register("")).toThrow(InvalidArgError);
    expect(() => h.register("a")).toThrow(StateError);
    expect(() => h.stamp("b", 1)).toThrow(UnknownError);
  });

  test("stamp ticks with physical time", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    clock.advance(10);
    const s1 = h.stamp("a", "x");
    expect(s1).toEqual(hlc(10, 0));
    const s2 = h.stamp("a", "y");
    expect(s2).toEqual(hlc(10, 1));
    clock.advance(5);
    const s3 = h.stamp("a", "z");
    expect(s3).toEqual(hlc(15, 0));
    expect(h.pending()).toHaveLength(3);
  });

  test("observe merges without enqueue", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    clock.advance(3);
    h.stamp("a", 1);
    const beforePending = h.pending().length;
    const after = h.observe("a", hlc(20, 4));
    expect(after.pt).toBe(20);
    expect(after.lc).toBe(5);
    expect(h.pending()).toHaveLength(beforePending);
    expect(() => h.observe("a", { pt: -1, lc: 0 })).toThrow(InvalidArgError);
  });

  test("frontier gates deliverability", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    clock.advance(1);
    h.stamp("a", "p");
    expect(h.deliver()).toEqual([]);
    h.advanceFrontier("a", hlc(1, 0));
    const d = h.deliver();
    expect(d).toHaveLength(1);
    expect(d[0].payload).toBe("p");
    expect(h.pending()).toHaveLength(0);
    expect(h.delivered()).toHaveLength(1);
  });

  test("frontier regression rejected", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    h.advanceFrontier("a", hlc(5, 2));
    const n = h.journal().length;
    expect(() => h.advanceFrontier("a", hlc(5, 1))).toThrow(StateError);
    expect(h.frontierOf("a")).toEqual(hlc(5, 2));
    expect(h.journal()).toHaveLength(n);
  });

  test("capacity on replicas and pending", () => {
    const clock = new VirtualClock();
    const h = make(clock, { maxReplicas: 1, maxPending: 1 });
    h.register("a");
    expect(() => h.register("b")).toThrow(CapacityError);
    clock.advance(1);
    h.stamp("a", 1);
    const n = h.journal().length;
    const clk = h.clockOf("a");
    expect(() => h.stamp("a", 2)).toThrow(CapacityError);
    expect(h.clockOf("a")).toEqual(clk);
    expect(h.pending()).toHaveLength(1);
    expect(h.journal()).toHaveLength(n);
  });

  test("checkpoint only delivered set", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    clock.advance(2);
    h.stamp("a", "keep-pending");
    h.stamp("a", "to-deliver");
    h.advanceFrontier("a", hlc(2, 0));
    // only first stamp (lc 0) is covered; second still pending if frontier is 2,0
    // actually both stamped at pt=2 with lc 0 and 1; frontier 2,0 covers only first
    const d = h.deliver();
    expect(d).toHaveLength(1);
    const chk = h.checkpoint("c1");
    expect(chk.deliveredIds).toEqual([d[0].msgId]);
    expect(h.pending()).toHaveLength(1);
    expect(h.readChk("c1").deliveredIds).toEqual(chk.deliveredIds);
    expect(() => h.readChk("missing")).toThrow(UnknownError);
  });

  test("checkpoint overwrite vs new name capacity", () => {
    const clock = new VirtualClock();
    const h = make(clock, { maxChk: 1 });
    h.register("a");
    clock.advance(1);
    h.stamp("a", 1);
    h.advanceFrontier("a", hlc(1, 0));
    h.deliver();
    h.checkpoint("only");
    // overwrite same name ok
    h.checkpoint("only");
    expect(() => h.checkpoint("other")).toThrow(CapacityError);
  });

  test("drive gc needs checkpoint intersection", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    clock.advance(1);
    h.stamp("a", "m1");
    h.stamp("a", "m2");
    h.advanceFrontier("a", hlc(1, 1));
    const all = h.deliver();
    expect(all).toHaveLength(2);
    // no checkpoints => drive removes nothing
    expect(h.drive()).toEqual([]);
    expect(h.delivered()).toHaveLength(2);
    h.checkpoint("c1");
    // single checkpoint intersection = its snapshot => both removable
    const removed = h.drive();
    expect(removed.sort()).toEqual(all.map((m) => m.msgId).sort());
    expect(h.delivered()).toHaveLength(0);
    // checkpoint itself still readable
    expect(h.readChk("c1").deliveredIds).toHaveLength(2);
  });

  // ---- interleaved (≥8) ----

  test("interleave: multi-replica causal deliver order", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    h.register("b");
    clock.advance(5);
    h.stamp("b", "b0"); // pt5 lc0
    clock.advance(1);
    h.stamp("a", "a0"); // pt6 lc0
    h.stamp("b", "b1"); // pt6 lc1? b was at 5,0; now=6 > 5 so pt6 lc0 — wait
    // After stamp b at 5,0: clock b = 5,0
    // advance 1 -> now=6
    // stamp a: a was 0,0 -> 6,0
    // stamp b: b was 5,0, now=6 > 5 -> 6,0
    // So a0 and b1 both 6,0 — order by replica name: a then b
    h.advanceFrontier("a", hlc(6, 0));
    h.advanceFrontier("b", hlc(6, 0));
    const d = h.deliver();
    expect(d.map((m) => m.payload)).toEqual(["b0", "a0", "b1"]);
    // b0 (5,0) first, then a0 (6,0) before b1 (6,0) by replica name
  });

  test("interleave: observe then stamp uses merged clock", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("r");
    clock.advance(2);
    h.observe("r", hlc(10, 3));
    const s = h.stamp("r", "after");
    expect(s.pt).toBeGreaterThanOrEqual(10);
    expect(HlcClocksLikeLe(hlc(10, 3), s)).toBe(true);
    expect(h.pending()).toHaveLength(1);
  });

  test("interleave: partial deliver max then frontier raise", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    clock.advance(4);
    h.stamp("a", 1);
    h.stamp("a", 2);
    h.stamp("a", 3);
    h.advanceFrontier("a", hlc(4, 2));
    const first = h.deliver(1);
    expect(first).toHaveLength(1);
    expect(h.pending()).toHaveLength(2);
    const rest = h.deliver();
    expect(rest).toHaveLength(2);
    expect(h.pending()).toHaveLength(0);
  });

  test("interleave: failed stamp then success keeps causal ids", () => {
    const clock = new VirtualClock();
    const h = make(clock, { maxPending: 2 });
    h.register("a");
    clock.advance(1);
    h.stamp("a", "ok1");
    h.stamp("a", "ok2");
    const clk = h.clockOf("a")!;
    expect(() => h.stamp("a", "fail")).toThrow(CapacityError);
    expect(h.clockOf("a")).toEqual(clk);
    h.advanceFrontier("a", hlc(1, 1));
    h.deliver();
    const s = h.stamp("a", "ok3");
    expect(s).toEqual(hlc(1, 2));
    expect(h.pending()).toHaveLength(1);
  });

  test("interleave: two checkpoints intersection gc", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    clock.advance(3);
    h.stamp("a", "x");
    h.stamp("a", "y");
    h.advanceFrontier("a", hlc(3, 0));
    const d1 = h.deliver(); // only first
    h.checkpoint("early");
    h.advanceFrontier("a", hlc(3, 1));
    const d2 = h.deliver();
    h.checkpoint("late");
    // intersection of early∩late = only d1 ids
    const removed = h.drive();
    expect(removed).toEqual(d1.map((m) => m.msgId));
    expect(h.delivered().map((m) => m.msgId)).toEqual(d2.map((m) => m.msgId));
  });

  test("interleave: journal round-trip mid flow", () => {
    const clock = new VirtualClock();
    const h = make(clock, { maxPending: 10, maxChk: 4 });
    h.register("a");
    h.register("b");
    clock.advance(7);
    h.stamp("a", "a1");
    h.observe("b", hlc(9, 1));
    h.stamp("b", "b1");
    h.advanceFrontier("a", hlc(7, 0));
    h.advanceFrontier("b", hlc(9, 2));
    h.deliver(1);
    h.checkpoint("s");
    const rt = roundTrip(h, clock, { maxPending: 10, maxChk: 4 });
    expect(rt.replicas()).toEqual(h.replicas());
    expect(rt.clockOf("a")).toEqual(h.clockOf("a"));
    expect(rt.clockOf("b")).toEqual(h.clockOf("b"));
    expect(rt.frontierOf("a")).toEqual(h.frontierOf("a"));
    expect(rt.pending().map(msgKey)).toEqual(h.pending().map(msgKey));
    expect(rt.delivered().map(msgKey)).toEqual(h.delivered().map(msgKey));
    expect(rt.readChk("s")).toEqual(h.readChk("s"));
    // continue ops on restored
    clock.advance(2);
    rt.stamp("a", "a2");
    expect(rt.pending().some((m) => m.payload === "a2")).toBe(true);
  });

  test("interleave: cross-replica frontier lag holds messages", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    h.register("b");
    clock.advance(2);
    h.stamp("a", "A");
    h.stamp("b", "B");
    h.advanceFrontier("a", hlc(2, 0));
    // b has no frontier
    const d = h.deliver();
    expect(d.map((m) => m.payload)).toEqual(["A"]);
    expect(h.pending().map((m) => m.payload)).toEqual(["B"]);
    h.advanceFrontier("b", hlc(2, 0));
    expect(h.deliver().map((m) => m.payload)).toEqual(["B"]);
  });

  test("interleave: equal frontier no-op still journals", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    h.advanceFrontier("a", hlc(1, 0));
    const n = h.journal().length;
    const again = h.advanceFrontier("a", hlc(1, 0));
    expect(again).toEqual(hlc(1, 0));
    expect(h.journal().length).toBe(n + 1);
  });

  test("interleave: full recover after gc and more stamps", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("x");
    clock.advance(8);
    h.stamp("x", 1);
    h.advanceFrontier("x", hlc(8, 0));
    h.deliver();
    h.checkpoint("c");
    h.drive();
    clock.advance(1);
    h.stamp("x", 2);
    h.advanceFrontier("x", hlc(9, 0));
    const rt = roundTrip(h, clock);
    expect(rt.delivered()).toEqual([]);
    expect(rt.pending()).toHaveLength(1);
    expect(rt.deliver().map((m) => m.payload)).toEqual([2]);
    expect(rt.readChk("c").deliveredIds.length).toBe(1);
  });

  test("deliver max rejects negative", () => {
    const clock = new VirtualClock();
    const h = make(clock);
    h.register("a");
    expect(() => h.deliver(-1)).toThrow(InvalidArgError);
  });

  test("virtual clock rejects negative advance", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });
});

function msgKey(m: OutMsg): string {
  return `${m.msgId}:${m.replica}:${m.hlc.pt}.${m.hlc.lc}:${JSON.stringify(m.payload)}`;
}

function HlcClocksLikeLe(a: Hlc, b: Hlc): boolean {
  if (a.pt !== b.pt) return a.pt < b.pt;
  return a.lc <= b.lc;
}
