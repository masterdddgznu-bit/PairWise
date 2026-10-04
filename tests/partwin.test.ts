import {
  VirtualClock,
  PartWin,
  InvalidConfigError,
  InvalidOpenError,
  UnknownAssemblyError,
  CapacityError,
  KeyBusyError,
} from "../src/index.js";

function pw(
  o: Partial<{ maxOpen: number; defaultTtlMs: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new PartWin({
    clock,
    maxOpen: o.maxOpen ?? 4,
    defaultTtlMs: o.defaultTtlMs ?? 10,
  });
  return { clock, n };
}

describe("partwin hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new PartWin({ clock, maxOpen: 0 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new PartWin({ clock, defaultTtlMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("open put complete take in part order", () => {
    const { n } = pw();
    const { assemblyId } = n.open("k", 3);
    expect(n.put(assemblyId, 1, "b")).toEqual({ status: "accepted" });
    expect(n.put(assemblyId, 0, "a")).toEqual({ status: "accepted" });
    expect(n.missingParts(assemblyId)).toEqual([2]);
    expect(n.put(assemblyId, 2, "c")).toEqual({ status: "completed" });
    expect(n.statusOf(assemblyId)).toBe("ready");
    expect(n.take()).toEqual({
      assemblyId,
      key: "k",
      parts: ["a", "b", "c"],
    });
    expect(n.statusOf(assemblyId)).toBe("taken");
    expect(n.take()).toBeNull();
  });

  test("duplicate part rejected; no overwrite", () => {
    const { n } = pw();
    const { assemblyId } = n.open("k", 2);
    expect(n.put(assemblyId, 0, "a")).toEqual({ status: "accepted" });
    expect(n.put(assemblyId, 0, "X")).toEqual({ status: "rejected" });
    expect(n.put(assemblyId, 1, "b")).toEqual({ status: "completed" });
    expect(n.take()?.parts).toEqual(["a", "b"]);
  });

  test("key busy while open; free after complete", () => {
    const { n } = pw();
    n.open("k", 2);
    expect(() => n.open("k", 2)).toThrow(KeyBusyError);
    const id = n.openIds()[0];
    n.put(id, 0, 1);
    n.put(id, 1, 2);
    expect(n.open("k", 2).assemblyId).toBeGreaterThan(id);
  });

  test("key free after cancel and expire", () => {
    const { clock, n } = pw({ defaultTtlMs: 5 });
    const a = n.open("a", 2).assemblyId;
    expect(n.cancel(a)).toBe(true);
    expect(n.cancel(a)).toBe(false);
    const b = n.open("a", 2).assemblyId;
    clock.advance(5);
    expect(n.put(b, 0, 1).status).toBe("rejected");
    expect(n.drive().expired).toEqual([b]);
    expect(n.statusOf(b)).toBe("expired");
    expect(n.open("a", 2).assemblyId).toBeGreaterThan(b);
  });

  test("capacity only counts open not ready", () => {
    const { n } = pw({ maxOpen: 2 });
    const a = n.open("a", 2).assemblyId;
    const b = n.open("b", 2).assemblyId;
    expect(() => n.open("c", 2)).toThrow(CapacityError);
    n.put(a, 0, 1);
    n.put(a, 1, 2);
    expect(n.statusOf(a)).toBe("ready");
    const c = n.open("c", 2).assemblyId;
    expect(n.openIds().sort()).toEqual([b, c].sort());
  });

  test("take orders by completedAt then id", () => {
    const { clock, n } = pw({ defaultTtlMs: 100 });
    const a = n.open("a", 2).assemblyId;
    const b = n.open("b", 2).assemblyId;
    n.put(b, 0, 1);
    n.put(b, 1, 2); // b completes at t=0
    clock.advance(1);
    n.put(a, 0, 1);
    n.put(a, 1, 2); // a completes at t=1
    expect(n.readyIds()).toEqual([b, a]);
    expect(n.take()?.assemblyId).toBe(b);
    expect(n.take()?.assemblyId).toBe(a);
  });

  test("same completedAt tie-break by assemblyId", () => {
    const { n } = pw();
    const a = n.open("a", 2).assemblyId;
    const b = n.open("b", 2).assemblyId;
    n.put(a, 0, 1);
    n.put(b, 0, 1);
    n.put(b, 1, 2);
    n.put(a, 1, 2);
    // both completedAt 0; smaller id first
    expect(n.readyIds()[0]).toBe(Math.min(a, b));
    expect(n.take()?.assemblyId).toBe(Math.min(a, b));
  });

  test("put after deadline rejected; drive expires once", () => {
    const { clock, n } = pw({ defaultTtlMs: 3 });
    const id = n.open("k", 3).assemblyId;
    n.put(id, 0, "x");
    clock.advance(3);
    expect(n.put(id, 1, "y").status).toBe("rejected");
    expect(n.drive().expired).toEqual([id]);
    expect(n.drive().expired).toEqual([]);
    expect(n.filledCount(id)).toBe(1);
    expect(n.openIds()).toEqual([]);
  });

  test("invalid open args; bad part index rejected", () => {
    const { n } = pw();
    expect(() => n.open("", 2)).toThrow(InvalidOpenError);
    expect(() => n.open("k", 1)).toThrow(InvalidOpenError);
    expect(() => n.open("k", 2, { ttlMs: 0 })).toThrow(InvalidOpenError);
    const id = n.open("k", 2).assemblyId;
    expect(n.put(id, -1, 1).status).toBe("rejected");
    expect(n.put(id, 2, 1).status).toBe("rejected");
    expect(n.put(id, 1.5, 1).status).toBe("rejected");
  });

  test("unknown assembly errors", () => {
    const { n } = pw();
    expect(() => n.put(9, 0, 1)).toThrow(UnknownAssemblyError);
    expect(() => n.cancel(9)).toThrow(UnknownAssemblyError);
    expect(() => n.statusOf(9)).toThrow(UnknownAssemblyError);
    expect(() => n.filledCount(9)).toThrow(UnknownAssemblyError);
    expect(() => n.missingParts(9)).toThrow(UnknownAssemblyError);
  });

  test("cancel does not affect ready; put on ready rejected", () => {
    const { n } = pw();
    const id = n.open("k", 2).assemblyId;
    n.put(id, 0, 1);
    n.put(id, 1, 2);
    expect(n.cancel(id)).toBe(false);
    expect(n.put(id, 0, 9).status).toBe("rejected");
    expect(n.take()?.assemblyId).toBe(id);
  });

  test("drive expires multiple ascending; capacity freed", () => {
    const { clock, n } = pw({ maxOpen: 2, defaultTtlMs: 4 });
    const a = n.open("a", 2).assemblyId;
    const b = n.open("b", 2).assemblyId;
    clock.advance(4);
    expect(n.drive().expired).toEqual([a, b].sort((x, y) => x - y));
    n.open("c", 2);
    n.open("d", 2);
  });

  test("custom ttlMs; elapsed zero keeps open", () => {
    const { clock, n } = pw({ defaultTtlMs: 100 });
    const id = n.open("k", 2, { ttlMs: 2 }).assemblyId;
    clock.advance(1);
    expect(n.put(id, 0, 1).status).toBe("accepted");
    clock.advance(1);
    expect(n.put(id, 1, 2).status).toBe("rejected");
    expect(n.drive().expired).toEqual([id]);
  });

  test("clock negative throws", () => {
    const { clock } = pw();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("reopen after taken", () => {
    const { n } = pw();
    const id = n.open("k", 2).assemblyId;
    n.put(id, 0, 1);
    n.put(id, 1, 2);
    n.take();
    const id2 = n.open("k", 2).assemblyId;
    expect(id2).not.toBe(id);
    expect(n.statusOf(id)).toBe("taken");
  });

  test("partial missingParts stable across rejects", () => {
    const { n } = pw();
    const id = n.open("k", 3).assemblyId;
    n.put(id, 2, "z");
    expect(n.missingParts(id)).toEqual([0, 1]);
    n.put(id, 2, "again");
    expect(n.filledCount(id)).toBe(1);
    expect(n.missingParts(id)).toEqual([0, 1]);
  });
});
