import {
  VirtualClock,
  WireHold,
  InvalidConfigError,
  InvalidAccountError,
  InvalidWireError,
  FenceError,
  UnknownWireError,
} from "../src/index.js";

function wh(
  o: Partial<{ holdTimeoutMs: number; maxOpenWiresPerAccount: number }> = {},
) {
  const clock = new VirtualClock();
  const n = new WireHold({
    clock,
    holdTimeoutMs: o.holdTimeoutMs ?? 10,
    maxOpenWiresPerAccount: o.maxOpenWiresPerAccount ?? 2,
  });
  return { clock, n };
}

describe("wirehold hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new WireHold({ clock, holdTimeoutMs: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("open accounts; wire holds funds; commit transfers", () => {
    const { n } = wh();
    n.openAccount("a", 100);
    n.openAccount("b", 0);
    const w = n.wire("a", "b", 40);
    expect(n.balanceOf("a")).toEqual({
      available: 60,
      held: 40,
      total: 100,
    });
    expect(n.commit(w.wireId, w.fence)).toBe(true);
    expect(n.balanceOf("a")).toEqual({
      available: 60,
      held: 0,
      total: 60,
    });
    expect(n.balanceOf("b")).toEqual({
      available: 40,
      held: 0,
      total: 40,
    });
    expect(n.statusOf(w.wireId)).toBe("committed");
  });

  test("abort restores available", () => {
    const { n } = wh();
    n.openAccount("a", 50);
    n.openAccount("b", 0);
    const w = n.wire("a", "b", 20);
    expect(n.abort(w.wireId, w.fence)).toBe(true);
    expect(n.balanceOf("a")).toEqual({
      available: 50,
      held: 0,
      total: 50,
    });
    expect(n.balanceOf("b").total).toBe(0);
    expect(n.statusOf(w.wireId)).toBe("aborted");
  });

  test("insufficient funds; self wire; bad amount", () => {
    const { n } = wh();
    n.openAccount("a", 10);
    n.openAccount("b", 0);
    expect(() => n.wire("a", "b", 11)).toThrow(InvalidWireError);
    expect(() => n.wire("a", "a", 1)).toThrow(InvalidWireError);
    expect(() => n.wire("a", "b", 0)).toThrow(InvalidWireError);
    expect(n.balanceOf("a").available).toBe(10);
  });

  test("max open wires per payer; fence increments per payer", () => {
    const { n } = wh({ maxOpenWiresPerAccount: 1 });
    n.openAccount("a", 100);
    n.openAccount("b", 0);
    n.openAccount("c", 0);
    const w1 = n.wire("a", "b", 10);
    expect(w1.fence).toBe(1);
    expect(() => n.wire("a", "c", 10)).toThrow(InvalidWireError);
    n.commit(w1.wireId, w1.fence);
    const w2 = n.wire("a", "c", 10);
    expect(w2.fence).toBe(2);
  });

  test("timeout releases hold; late commit false", () => {
    const { clock, n } = wh({ holdTimeoutMs: 5 });
    n.openAccount("a", 30);
    n.openAccount("b", 0);
    const w = n.wire("a", "b", 30);
    clock.advance(5);
    expect(n.drive().timedOut).toEqual([w.wireId]);
    expect(n.statusOf(w.wireId)).toBe("timedout");
    expect(n.balanceOf("a")).toEqual({
      available: 30,
      held: 0,
      total: 30,
    });
    expect(n.commit(w.wireId, w.fence)).toBe(false);
  });

  test("wrong fence throws; unknown wire; duplicate account", () => {
    const { n } = wh();
    n.openAccount("a", 20);
    n.openAccount("b", 0);
    const w = n.wire("a", "b", 5);
    expect(() => n.commit(w.wireId, w.fence + 1)).toThrow(FenceError);
    expect(() => n.abort(w.wireId, 0)).toThrow(FenceError);
    expect(() => n.statusOf(99)).toThrow(UnknownWireError);
    expect(() => n.openAccount("a", 1)).toThrow(InvalidAccountError);
  });

  test("concurrent holds reduce available; commit one keeps other held", () => {
    const { n } = wh({ maxOpenWiresPerAccount: 3 });
    n.openAccount("a", 100);
    n.openAccount("b", 0);
    n.openAccount("c", 0);
    const w1 = n.wire("a", "b", 40);
    const w2 = n.wire("a", "c", 40);
    expect(n.balanceOf("a")).toEqual({
      available: 20,
      held: 80,
      total: 100,
    });
    expect(n.openWiresOf("a")).toEqual([w1.wireId, w2.wireId]);
    n.commit(w1.wireId, w1.fence);
    expect(n.balanceOf("a")).toEqual({
      available: 20,
      held: 40,
      total: 60,
    });
    expect(n.balanceOf("b").available).toBe(40);
  });

  test("drive sorts multiple timeouts; empty drive", () => {
    const { clock, n } = wh({ holdTimeoutMs: 3, maxOpenWiresPerAccount: 4 });
    n.openAccount("a", 50);
    n.openAccount("b", 0);
    const x = n.wire("a", "b", 10);
    const y = n.wire("a", "b", 10);
    clock.advance(3);
    expect(n.drive().timedOut).toEqual([x.wireId, y.wireId]);
    expect(n.drive().timedOut).toEqual([]);
  });

  test("abort after commit false; clock negative; unknown account", () => {
    const { clock, n } = wh();
    n.openAccount("a", 10);
    n.openAccount("b", 0);
    const w = n.wire("a", "b", 5);
    n.commit(w.wireId, w.fence);
    expect(n.abort(w.wireId, w.fence)).toBe(false);
    expect(() => clock.advance(-1)).toThrow();
    expect(() => n.balanceOf("z")).toThrow(InvalidAccountError);
  });

  test("receiver can also be payer on other wires", () => {
    const { n } = wh();
    n.openAccount("a", 20);
    n.openAccount("b", 20);
    const w = n.wire("a", "b", 10);
    n.commit(w.wireId, w.fence);
    const w2 = n.wire("b", "a", 5);
    expect(n.balanceOf("b")).toEqual({
      available: 25,
      held: 5,
      total: 30,
    });
    n.abort(w2.wireId, w2.fence);
    expect(n.balanceOf("b").available).toBe(30);
  });

  test("openAccount rejects negative and empty id", () => {
    const { n } = wh();
    expect(() => n.openAccount("", 1)).toThrow(InvalidAccountError);
    expect(() => n.openAccount("a", -1)).toThrow(InvalidAccountError);
  });

  test("timedout wire fenceOf still readable", () => {
    const { clock, n } = wh({ holdTimeoutMs: 2 });
    n.openAccount("a", 5);
    n.openAccount("b", 0);
    const w = n.wire("a", "b", 5);
    clock.advance(2);
    n.drive();
    expect(n.fenceOf(w.wireId)).toBe(w.fence);
    expect(n.openWiresOf("a")).toEqual([]);
  });
});
