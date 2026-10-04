import {
  VirtualClock,
  CapChain,
  InvalidConfigError,
  InvalidMintError,
  InvalidDeriveError,
  UnknownCapError,
} from "../src/index.js";

function cc(o: Partial<{ ttlMs: number; maxChildren: number }> = {}) {
  const clock = new VirtualClock();
  const n = new CapChain({
    clock,
    ttlMs: o.ttlMs ?? 10,
    maxChildren: o.maxChildren ?? 4,
  });
  return { clock, n };
}

describe("capchain hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new CapChain({ clock, ttlMs: 0 })).toThrow(InvalidConfigError);
  });

  test("mint check under prefix; sibling path denied", () => {
    const { n } = cc();
    const id = n.mint("h", "/a", ["read", "write"]);
    expect(n.check(id, "/a", "read")).toBe(true);
    expect(n.check(id, "/a/x", "write")).toBe(true);
    expect(n.check(id, "/b", "read")).toBe(false);
    expect(n.check(id, "/a", "delete")).toBe(false);
    expect(n.opsOf(id)).toEqual(["read", "write"]);
  });

  test("derive attenuates; expand path or ops rejected", () => {
    const { n } = cc();
    const p = n.mint("h", "/a", ["read", "write"]);
    const c = n.derive("h", p, "/a/b", ["read"]);
    expect(n.parentOf(c)).toBe(p);
    expect(n.childrenOf(p)).toEqual([c]);
    expect(n.check(c, "/a/b/z", "read")).toBe(true);
    expect(n.check(c, "/a/b", "write")).toBe(false);
    expect(n.check(c, "/a", "read")).toBe(false);
    expect(() => n.derive("h", p, "/b", ["read"])).toThrow(InvalidDeriveError);
    expect(() => n.derive("h", p, "/a/c", ["read", "admin"])).toThrow(
      InvalidDeriveError,
    );
  });

  test("slash root covers; wrong holder cannot derive", () => {
    const { n } = cc();
    const p = n.mint("h", "/", ["op"]);
    expect(n.check(p, "/x", "op")).toBe(true);
    expect(() => n.derive("x", p, "/x", ["op"])).toThrow(InvalidDeriveError);
    const c = n.derive("h", p, "/x", ["op"]);
    expect(n.check(c, "/x/y", "op")).toBe(true);
  });

  test("revoke cascades children; grandchild check fails", () => {
    const { n } = cc();
    const a = n.mint("h", "/a", ["r"]);
    const b = n.derive("h", a, "/a/b", ["r"]);
    const c = n.derive("h", b, "/a/b/c", ["r"]);
    expect(n.revoke("h", a)).toBe(true);
    expect(n.check(a, "/a", "r")).toBe(false);
    expect(n.check(b, "/a/b", "r")).toBe(false);
    expect(n.check(c, "/a/b/c", "r")).toBe(false);
    expect(n.revoke("h", a)).toBe(false);
    expect(n.revoke("z", b)).toBe(false);
  });

  test("child heartbeat does not save parent expire cascade", () => {
    const { clock, n } = cc({ ttlMs: 5 });
    const a = n.mint("h", "/a", ["r"]);
    clock.advance(2);
    const b = n.derive("h", a, "/a/b", ["r"]);
    clock.advance(2);
    expect(n.heartbeat("h", b)).toBe(true);
    clock.advance(1);
    const d = n.drive();
    expect(d.expired).toEqual([a]);
    expect(n.check(b, "/a/b", "r")).toBe(false);
    expect(() => n.derive("h", a, "/a/z", ["r"])).toThrow(InvalidDeriveError);
  });

  test("only self-expired ids in drive; later child expire listed", () => {
    const { clock, n } = cc({ ttlMs: 4 });
    const a = n.mint("h", "/a", ["r"]);
    const b = n.derive("h", a, "/a/b", ["r"]);
    clock.advance(2);
    n.heartbeat("h", b);
    clock.advance(2);
    expect(n.drive().expired).toEqual([a]);
    expect(n.drive().expired).toEqual([]);
    clock.advance(2);
    expect(n.drive().expired).toEqual([b]);
  });

  test("maxChildren; unknown cap; bad mint", () => {
    const { n } = cc({ maxChildren: 1 });
    const p = n.mint("h", "/a", ["r", "r"]);
    n.derive("h", p, "/a/b", ["r"]);
    expect(() => n.derive("h", p, "/a/c", ["r"])).toThrow(InvalidDeriveError);
    expect(() => n.check(99, "/a", "r")).toThrow(UnknownCapError);
    expect(() => n.mint("", "/a", ["r"])).toThrow(InvalidMintError);
    expect(() => n.mint("h", "", ["r"])).toThrow(InvalidMintError);
    expect(() => n.mint("h", "/a", [])).toThrow(InvalidMintError);
  });

  test("heartbeat false after expire; unknown heartbeat throws", () => {
    const { clock, n } = cc({ ttlMs: 3 });
    const a = n.mint("h", "/a", ["r"]);
    expect(n.heartbeat("z", a)).toBe(false);
    clock.advance(3);
    expect(n.heartbeat("h", a)).toBe(false);
    expect(() => n.heartbeat("h", 9)).toThrow(UnknownCapError);
  });

  test("clock negative; queries", () => {
    const { clock, n } = cc();
    expect(() => clock.advance(-1)).toThrow();
    const a = n.mint("h", "/p", ["z"]);
    expect(n.holderOf(a)).toBe("h");
    expect(n.prefixOf(a)).toBe("/p");
    expect(n.parentOf(a)).toBeNull();
    expect(n.childrenOf(a)).toEqual([]);
  });

  test("equal prefix derive with fewer ops ok", () => {
    const { n } = cc();
    const p = n.mint("h", "/a", ["r", "w"]);
    const c = n.derive("h", p, "/a", ["w"]);
    expect(n.check(c, "/a", "w")).toBe(true);
    expect(n.check(c, "/a", "r")).toBe(false);
  });

  test("revoke expired parent still marks children", () => {
    const { clock, n } = cc({ ttlMs: 2 });
    const a = n.mint("h", "/a", ["r"]);
    const b = n.derive("h", a, "/a/b", ["r"]);
    clock.advance(2);
    expect(n.revoke("h", a)).toBe(true);
    clock.advance(10);
    n.heartbeat("h", b);
    expect(n.check(b, "/a/b", "r")).toBe(false);
  });

  test("duplicate ops mint unique; empty op rejected", () => {
    const { n } = cc();
    const a = n.mint("h", "/a", ["b", "a", "b"]);
    expect(n.opsOf(a)).toEqual(["a", "b"]);
    expect(() => n.mint("h", "/a", ["x", ""])).toThrow(InvalidMintError);
  });
});
