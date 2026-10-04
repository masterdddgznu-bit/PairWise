import {
  VirtualClock,
  OwnMove,
  InvalidConfigError,
  InvalidClaimError,
  FenceError,
  InvalidHandoffError,
  UnknownResourceError,
} from "../src/index.js";

function om(o: Partial<{ handoffTimeoutMs: number }> = {}) {
  const clock = new VirtualClock();
  const n = new OwnMove({
    clock,
    handoffTimeoutMs: o.handoffTimeoutMs ?? 10,
  });
  return { clock, n };
}

describe("ownmove hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new OwnMove({ clock, handoffTimeoutMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("claim then full handoff commit bumps fence", () => {
    const { n } = om();
    const c = n.claim("a", "r");
    expect(c.fence).toBe(1);
    expect(n.ownerOf("r")).toBe("a");
    const p = n.prepare("a", "r", 1, "b");
    expect(n.accept("b", p.handoffId)).toBe(true);
    expect(n.statusOf(p.handoffId)).toBe("accepted");
    expect(n.commit("a", "r", 1, p.handoffId)).toBe(true);
    expect(n.ownerOf("r")).toBe("b");
    expect(n.fenceOf("r")).toBe(2);
    expect(n.handoffOf("r")).toBeUndefined();
    expect(n.statusOf(p.handoffId)).toBe("committed");
  });

  test("commit without accept fails; then abort clears", () => {
    const { n } = om();
    n.claim("a", "r");
    const p = n.prepare("a", "r", 1, "b");
    expect(n.commit("a", "r", 1, p.handoffId)).toBe(false);
    expect(n.abort("a", "r", 1, p.handoffId)).toBe(true);
    expect(n.statusOf(p.handoffId)).toBe("aborted");
    expect(n.ownerOf("r")).toBe("a");
    expect(n.fenceOf("r")).toBe(1);
  });

  test("stale fence on prepare/commit throws", () => {
    const { n } = om();
    n.claim("a", "r");
    const p = n.prepare("a", "r", 1, "b");
    n.accept("b", p.handoffId);
    n.commit("a", "r", 1, p.handoffId);
    expect(() => n.prepare("b", "r", 1, "c")).toThrow(FenceError);
    expect(() => n.prepare("a", "r", 2, "c")).toThrow(InvalidHandoffError);
  });

  test("cannot claim owned or during handoff", () => {
    const { n } = om();
    n.claim("a", "r");
    expect(() => n.claim("b", "r")).toThrow(InvalidClaimError);
    n.prepare("a", "r", 1, "b");
    expect(() => n.claim("c", "r")).toThrow(InvalidClaimError);
  });

  test("accept wrong party false; duplicate accept false", () => {
    const { n } = om();
    n.claim("a", "r");
    const p = n.prepare("a", "r", 1, "b");
    expect(n.accept("c", p.handoffId)).toBe(false);
    expect(n.accept("b", p.handoffId)).toBe(true);
    expect(n.accept("b", p.handoffId)).toBe(false);
  });

  test("timeout aborts handoff; late commit false", () => {
    const { clock, n } = om({ handoffTimeoutMs: 4 });
    n.claim("a", "r");
    const p = n.prepare("a", "r", 1, "b");
    n.accept("b", p.handoffId);
    clock.advance(4);
    expect(n.drive().timedOut).toEqual([p.handoffId]);
    expect(n.statusOf(p.handoffId)).toBe("timedout");
    expect(n.commit("a", "r", 1, p.handoffId)).toBe(false);
    expect(n.ownerOf("r")).toBe("a");
    expect(n.handoffOf("r")).toBeUndefined();
  });

  test("cannot prepare second while first active; after abort ok", () => {
    const { n } = om();
    n.claim("a", "r");
    const p1 = n.prepare("a", "r", 1, "b");
    expect(() => n.prepare("a", "r", 1, "c")).toThrow(InvalidHandoffError);
    n.abort("a", "r", 1, p1.handoffId);
    const p2 = n.prepare("a", "r", 1, "c");
    expect(p2.handoffId).toBe(2);
  });

  test("self handoff and empty ids rejected", () => {
    const { n } = om();
    n.claim("a", "r");
    expect(() => n.prepare("a", "r", 1, "a")).toThrow(InvalidHandoffError);
    expect(() => n.claim("", "r2")).toThrow(InvalidClaimError);
    expect(() => n.claim("a", "")).toThrow(InvalidClaimError);
  });

  test("unknown resource; unknown handoff; clock negative", () => {
    const { clock, n } = om();
    expect(() => n.ownerOf("no")).toThrow(UnknownResourceError);
    expect(() => n.statusOf(9)).toThrow(InvalidHandoffError);
    expect(() => clock.advance(-1)).toThrow();
  });

  test("old owner cannot commit after successful handoff", () => {
    const { n } = om();
    n.claim("a", "r");
    const p = n.prepare("a", "r", 1, "b");
    n.accept("b", p.handoffId);
    n.commit("a", "r", 1, p.handoffId);
    expect(() => n.commit("a", "r", 1, p.handoffId)).toThrow(FenceError);
    expect(n.commit("b", "r", 2, p.handoffId)).toBe(false);
    expect(n.ownerOf("r")).toBe("b");
  });

  test("drive sorts multiple timeouts", () => {
    const { clock, n } = om({ handoffTimeoutMs: 3 });
    n.claim("a", "r1");
    n.claim("b", "r2");
    const h1 = n.prepare("a", "r1", 1, "x");
    const h2 = n.prepare("b", "r2", 1, "y");
    clock.advance(3);
    expect(n.drive().timedOut).toEqual([h1.handoffId, h2.handoffId]);
  });

  test("abort after accept restores owner; new prepare uses same fence", () => {
    const { n } = om();
    n.claim("a", "r");
    const p = n.prepare("a", "r", 1, "b");
    n.accept("b", p.handoffId);
    expect(n.abort("a", "r", 1, p.handoffId)).toBe(true);
    expect(n.ownerOf("r")).toBe("a");
    expect(n.fenceOf("r")).toBe(1);
    const p2 = n.prepare("a", "r", 1, "c");
    expect(n.handoffOf("r")).toEqual({
      handoffId: p2.handoffId,
      toHolderId: "c",
      accepted: false,
    });
  });

  test("wrong owner abort/commit false without fence throw when fence ok", () => {
    const { n } = om();
    n.claim("a", "r");
    const p = n.prepare("a", "r", 1, "b");
    expect(n.abort("z", "r", 1, p.handoffId)).toBe(false);
    expect(n.commit("z", "r", 1, p.handoffId)).toBe(false);
  });
});
