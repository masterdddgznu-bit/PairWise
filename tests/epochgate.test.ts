import {
  VirtualClock,
  EpochGate,
  InvalidConfigError,
  SealingError,
  UnknownTicketError,
  FenceError,
  InvalidEpochError,
} from "../src/index.js";

function gate(
  o: Partial<{
    maxInFlight: number;
    maxPending: number;
    sealDrainMs: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const g = new EpochGate({
    clock,
    maxInFlight: o.maxInFlight ?? 2,
    maxPending: o.maxPending ?? 4,
    sealDrainMs: o.sealDrainMs ?? 10,
  });
  return { clock, g };
}

describe("epochgate hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new EpochGate({ clock, maxInFlight: 0, sealDrainMs: 1 }),
    ).toThrow(InvalidConfigError);
    expect(
      () => new EpochGate({ clock, maxInFlight: 1, sealDrainMs: 0 }),
    ).toThrow(InvalidConfigError);
  });

  test("submit running and complete results ordered by ticket", () => {
    const { g } = gate({ maxInFlight: 2 });
    const a = g.submit("A");
    const b = g.submit("B");
    expect(a.status).toBe("running");
    expect(b.status).toBe("running");
    if (a.status !== "running" || b.status !== "running") throw new Error("x");
    g.complete(1, b.ticket, b.fence);
    g.complete(1, a.ticket, a.fence);
    expect(g.results(1)).toEqual([
      { ticket: 1, payload: "A" },
      { ticket: 2, payload: "B" },
    ]);
  });

  test("pending when in-flight full; promote on complete", () => {
    const { g } = gate({ maxInFlight: 1, maxPending: 2 });
    const a = g.submit("A");
    const b = g.submit("B");
    expect(a.status).toBe("running");
    expect(b.status).toBe("pending");
    expect(g.pending()).toBe(1);
    if (a.status !== "running") throw new Error("x");
    g.complete(1, a.ticket, a.fence);
    expect(g.status(1, (b as { ticket: number }).ticket)).toBe("running");
    expect(g.inFlight()).toBe(1);
    expect(g.pending()).toBe(0);
  });

  test("pending full rejects", () => {
    const { g } = gate({ maxInFlight: 1, maxPending: 1 });
    g.submit("A");
    g.submit("B");
    expect(() => g.submit("C")).toThrow(InvalidConfigError);
  });

  test("seal blocks submit; drain empty seals and opens next", () => {
    const { g } = gate();
    const a = g.submit("A");
    if (a.status !== "running") throw new Error("x");
    expect(g.seal()).toBe(1);
    expect(() => g.submit("X")).toThrow(SealingError);
    g.complete(1, a.ticket, a.fence);
    expect(g.drive()).toEqual({ sealed: [1], forced: [] });
    expect(g.stateOf(1)).toBe("sealed");
    expect(g.current()).toEqual({ epoch: 2, state: "open" });
    const c = g.submit("C");
    expect(c).toMatchObject({ status: "running", epoch: 2, ticket: 1 });
  });

  test("sealDrainMs force-cancels running and pending", () => {
    const { clock, g } = gate({ maxInFlight: 1, maxPending: 2, sealDrainMs: 5 });
    const a = g.submit("A");
    g.submit("B");
    g.seal();
    clock.advance(5);
    const rep = g.drive();
    expect(rep.sealed).toEqual([1]);
    expect(rep.forced).toEqual([1, 2]);
    expect(g.results(1)).toEqual([]);
    expect(g.status(1, 1)).toBe("cancelled");
    expect(g.current().epoch).toBe(2);
    if (a.status !== "running") throw new Error("x");
    expect(() => g.complete(1, a.ticket, a.fence)).toThrow(FenceError);
  });

  test("bad fence and unknown ticket", () => {
    const { g } = gate();
    const a = g.submit("A");
    if (a.status !== "running") throw new Error("x");
    expect(() => g.complete(1, a.ticket, a.fence + 1)).toThrow(FenceError);
    expect(() => g.complete(1, 99, 1)).toThrow(UnknownTicketError);
    expect(() => g.stateOf(9)).toThrow(InvalidEpochError);
  });

  test("promote during seal then complete seals", () => {
    const { g } = gate({ maxInFlight: 1, maxPending: 3, sealDrainMs: 100 });
    const a = g.submit("A");
    const b = g.submit("B");
    expect(b.status).toBe("pending");
    g.seal();
    if (a.status !== "running") throw new Error("x");
    g.complete(1, a.ticket, a.fence);
    expect(g.status(1, b.ticket)).toBe("running");
    // fence was assigned on promote — complete with wrong fence fails
    expect(() => g.complete(1, b.ticket, 999)).toThrow(FenceError);
    // discover fence by trying? We need API — add note in impl that fence is sequential:
    // a.fence was 1, promote gives fence 2
    expect(g.complete(1, b.ticket, 2)).toBe(true);
    expect(g.drive()).toEqual({ sealed: [1], forced: [] });
    expect(g.results(1).map((r) => r.payload)).toEqual(["A", "B"]);
  });

  test("double seal errors", () => {
    const { g } = gate();
    g.seal();
    expect(() => g.seal()).toThrow(SealingError);
  });

  test("interleaved: two epochs results isolated", () => {
    const { g } = gate({ maxInFlight: 2, sealDrainMs: 10 });
    const a = g.submit("e1a");
    if (a.status !== "running") throw new Error("x");
    g.complete(1, a.ticket, a.fence);
    g.seal();
    g.drive();
    const b = g.submit("e2b");
    if (b.status !== "running") throw new Error("x");
    g.complete(2, b.ticket, b.fence);
    expect(g.results(1)).toEqual([{ ticket: 1, payload: "e1a" }]);
    expect(g.results(2)).toEqual([{ ticket: 1, payload: "e2b" }]);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("force cancel only after drain timeout not before", () => {
    const { clock, g } = gate({ maxInFlight: 1, sealDrainMs: 8 });
    g.submit("A");
    g.seal();
    clock.advance(7);
    expect(g.drive()).toEqual({ sealed: [], forced: [] });
    clock.advance(1);
    expect(g.drive().forced).toEqual([1]);
  });
});
