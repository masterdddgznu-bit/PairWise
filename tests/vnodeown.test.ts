import {
  VirtualClock,
  VnodeOwn,
  InvalidConfigError,
  InvalidArgError,
  CapacityError,
  LeaseError,
  FenceError,
  StateError,
  UnknownError,
} from "../src/index.js";

type Opts = {
  leaseMs?: number;
  vnodeCount?: number;
  maxNodes?: number;
  maxPending?: number;
  maxKeys?: number;
};

function make(clock: VirtualClock, o: Opts = {}) {
  return new VnodeOwn({
    clock,
    leaseMs: o.leaseMs ?? 10,
    vnodeCount: o.vnodeCount ?? 8,
    maxNodes: o.maxNodes,
    maxPending: o.maxPending,
    maxKeys: o.maxKeys,
  });
}

function roundTrip(v: VnodeOwn, clock: VirtualClock, o: Opts = {}) {
  return VnodeOwn.fromJournal(
    clock,
    {
      leaseMs: o.leaseMs ?? 10,
      vnodeCount: o.vnodeCount ?? 8,
      maxNodes: o.maxNodes,
      maxPending: o.maxPending,
      maxKeys: o.maxKeys,
    },
    v.journal(),
  );
}

function bootTwo(clock: VirtualClock, o: Opts = {}) {
  const v = make(clock, o);
  const a = v.acquire("a");
  const b = v.acquire("b");
  v.join("a");
  v.join("b");
  return { v, a, b };
}

describe("vnodeown hell+", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(() => new VnodeOwn({ clock, leaseMs: 0, vnodeCount: 8 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new VnodeOwn({ clock, leaseMs: 10, vnodeCount: 3 })).toThrow(
      InvalidConfigError,
    );
    expect(() => new VnodeOwn({ clock, leaseMs: 10, vnodeCount: 8, maxNodes: 0 })).toThrow(
      InvalidConfigError,
    );
  });

  test("stable key to vnode mapping", () => {
    const clock = new VirtualClock();
    const v = make(clock);
    const x = v.vnodeOf("alpha");
    const y = v.vnodeOf("alpha");
    expect(x).toBe(y);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThan(8);
    expect(() => v.vnodeOf("")).toThrow(InvalidArgError);
  });

  test("acquire renew release happy path", () => {
    const clock = new VirtualClock();
    const v = make(clock, { leaseMs: 5 });
    const a = v.acquire("n1");
    expect(a.fence).toBe(1);
    expect(a.expireAt).toBe(5);
    const r = v.renew("n1", a.fence);
    expect(r.expireAt).toBe(5);
    clock.advance(1);
    const r2 = v.renew("n1", a.fence);
    expect(r2.expireAt).toBe(6);
    v.release("n1", a.fence);
    expect(v.leaseInfo("n1")).toBeNull();
  });

  test("double acquire and fence mismatch", () => {
    const clock = new VirtualClock();
    const v = make(clock);
    const a = v.acquire("n1");
    const n = v.journal().length;
    expect(() => v.acquire("n1")).toThrow(StateError);
    expect(v.journal().length).toBe(n);
    expect(() => v.renew("n1", a.fence + 1)).toThrow(FenceError);
    expect(v.journal().length).toBe(n);
  });

  test("join requires lease and assigns owners", () => {
    const clock = new VirtualClock();
    const v = make(clock);
    const n = v.journal().length;
    expect(() => v.join("a")).toThrow(LeaseError);
    expect(v.journal().length).toBe(n);
    v.acquire("a");
    v.join("a");
    expect(v.joined()).toEqual(["a"]);
    expect(v.ownerOfVnode(0)).toBe("a");
    expect(v.ownerOf("k")).toBe("a");
  });

  test("put get under single owner", () => {
    const clock = new VirtualClock();
    const v = make(clock);
    v.acquire("a");
    v.join("a");
    const r = v.put("k1", 42);
    expect(r.owner).toBe("a");
    expect(r.migrating).toBe(false);
    expect(v.get("k1")).toBe(42);
    expect(v.get("missing")).toBeUndefined();
  });

  test("put without owner fails without wal growth", () => {
    const clock = new VirtualClock();
    const v = make(clock);
    const n = v.journal().length;
    expect(() => v.put("k", 1)).toThrow(StateError);
    expect(v.journal().length).toBe(n);
  });

  test("release while joined rejected", () => {
    const clock = new VirtualClock();
    const v = make(clock);
    const a = v.acquire("a");
    v.join("a");
    const n = v.journal().length;
    expect(() => v.release("a", a.fence)).toThrow(StateError);
    expect(v.journal().length).toBe(n);
  });

  test("node capacity", () => {
    const clock = new VirtualClock();
    const v = make(clock, { maxNodes: 1 });
    v.acquire("a");
    v.join("a");
    v.acquire("b");
    const n = v.journal().length;
    expect(() => v.join("b")).toThrow(CapacityError);
    expect(v.journal().length).toBe(n);
    expect(v.joined()).toEqual(["a"]);
  });

  test("key capacity", () => {
    const clock = new VirtualClock();
    const v = make(clock, { maxKeys: 1 });
    v.acquire("a");
    v.join("a");
    v.put("k1", 1);
    const n = v.journal().length;
    expect(() => v.put("k2", 2)).toThrow(CapacityError);
    expect(v.journal().length).toBe(n);
    v.put("k1", 9);
    expect(v.get("k1")).toBe(9);
  });

  // interleaved (≥8)
  test("interleave: two nodes join put then leave migrates", () => {
    const clock = new VirtualClock();
    const { v, a } = bootTwo(clock);
    // fill several keys under dual ownership
    for (let i = 0; i < 6; i++) v.put(`k${i}`, i);
    const beforeOwners = new Map(
      ["k0", "k1", "k2", "k3", "k4", "k5"].map((k) => [k, v.ownerOf(k)]),
    );
    v.leave("b");
    // keys whose owner was b should be pending (moved to a)
    const pending = v.pending();
    for (const rec of pending) {
      expect(rec.to).toBe("a");
      expect(beforeOwners.get(rec.key)).toBe("b");
      expect(() => v.get(rec.key)).toThrow(StateError);
      // put during migrate allowed
      const r = v.put(rec.key, "moved");
      expect(r.migrating).toBe(true);
      expect(r.owner).toBe("a");
    }
    const drained = v.drain();
    expect(drained.sort()).toEqual(pending.map((p) => p.key).sort());
    for (const rec of pending) {
      expect(v.get(rec.key)).toBe("moved");
    }
    v.release("b", v.leaseInfo("b")!.fence);
    v.leave("a");
    v.release("a", a.fence);
  });

  test("interleave: ackMigrate single key then readable", () => {
    const clock = new VirtualClock();
    const { v } = bootTwo(clock, { vnodeCount: 8 });
    // find a key owned by b
    let key: string | null = null;
    for (let i = 0; i < 40; i++) {
      const k = `x${i}`;
      if (v.ownerOf(k) === "b") {
        key = k;
        break;
      }
    }
    expect(key).not.toBeNull();
    v.put(key!, "v");
    v.leave("b");
    expect(v.pending().some((p) => p.key === key)).toBe(true);
    expect(() => v.get(key!)).toThrow(StateError);
    v.ackMigrate(key!);
    expect(v.get(key!)).toBe("v");
    expect(() => v.ackMigrate(key!)).toThrow(UnknownError);
  });

  test("interleave: renew keeps join alive across time", () => {
    const clock = new VirtualClock();
    const v = make(clock, { leaseMs: 10 });
    const a = v.acquire("a");
    v.join("a");
    v.put("k", 1);
    clock.advance(9);
    v.renew("a", a.fence);
    clock.advance(9);
    expect(v.drive()).toEqual([]);
    expect(v.joined()).toEqual(["a"]);
    expect(v.get("k")).toBe(1);
  });

  test("interleave: drive expires joined node and migrates", () => {
    const clock = new VirtualClock();
    const { v } = bootTwo(clock, { leaseMs: 10 });
    let keyB: string | null = null;
    for (let i = 0; i < 50; i++) {
      const k = `m${i}`;
      if (v.ownerOf(k) === "b") {
        keyB = k;
        break;
      }
    }
    expect(keyB).not.toBeNull();
    v.put(keyB!, "B");
    // keep a alive (renew before both hit expireAt), let b expire
    clock.advance(9);
    v.renew("a", v.leaseInfo("a")!.fence);
    clock.advance(1);
    const expired = v.drive();
    expect(expired).toContain("b");
    expect(expired).not.toContain("a");
    expect(v.joined()).toEqual(["a"]);
    expect(v.pending().some((p) => p.key === keyB)).toBe(true);
    expect(() => v.get(keyB!)).toThrow(StateError);
    v.drain();
    expect(v.get(keyB!)).toBe("B");
  });

  test("interleave: maxPending blocks leave atomically", () => {
    const clock = new VirtualClock();
    const { v } = bootTwo(clock, { maxPending: 1, vnodeCount: 8 });
    // place two keys currently owned by b
    const keysB: string[] = [];
    for (let i = 0; i < 80 && keysB.length < 2; i++) {
      const k = `p${i}`;
      if (v.ownerOf(k) === "b") keysB.push(k);
    }
    expect(keysB.length).toBe(2);
    v.put(keysB[0], 1);
    v.put(keysB[1], 2);
    const joinedBefore = v.joined().slice();
    const walBefore = v.journal().length;
    expect(() => v.leave("b")).toThrow(CapacityError);
    expect(v.joined()).toEqual(joinedBefore);
    expect(v.journal().length).toBe(walBefore);
    expect(v.pending()).toHaveLength(0);
    expect(v.get(keysB[0])).toBe(1);
  });

  test("interleave: fence bump after release then rejoin", () => {
    const clock = new VirtualClock();
    const v = make(clock, { leaseMs: 20 });
    const a1 = v.acquire("a");
    v.join("a");
    v.put("k", 1);
    v.leave("a");
    v.release("a", a1.fence);
    const a2 = v.acquire("a");
    expect(a2.fence).toBe(a1.fence + 1);
    v.join("a");
    expect(v.get("k")).toBe(1);
    expect(() => v.renew("a", a1.fence)).toThrow(FenceError);
  });

  test("interleave: fromJournal restores ownership pending and leases", () => {
    const clock = new VirtualClock();
    const { v } = bootTwo(clock, { leaseMs: 50 });
    let keyB: string | null = null;
    for (let i = 0; i < 40; i++) {
      const k = `j${i}`;
      if (v.ownerOf(k) === "b") {
        keyB = k;
        break;
      }
    }
    v.put(keyB!, "x");
    v.put("shared", 7);
    v.leave("b");
    expect(v.pending().length).toBeGreaterThan(0);
    const snapJoined = v.joined().slice();
    const snapPending = v.pending().map((p) => ({ ...p }));
    const snapOwner = v.ownerOf("shared");
    const snapLeaseA = v.leaseInfo("a");
    const restored = roundTrip(v, clock, { leaseMs: 50 });
    expect(restored.joined()).toEqual(snapJoined);
    expect(restored.pending()).toEqual(snapPending);
    expect(restored.ownerOf("shared")).toBe(snapOwner);
    expect(restored.leaseInfo("a")).toEqual(snapLeaseA);
    expect(() => restored.get(keyB!)).toThrow(StateError);
    restored.drain();
    expect(restored.get(keyB!)).toBe("x");
    expect(restored.get("shared")).toBe(7);
  });

  test("interleave: journal round-trip then further mutate", () => {
    const clock = new VirtualClock();
    const { v } = bootTwo(clock, { leaseMs: 30 });
    v.put("z", 1);
    const r = roundTrip(v, clock, { leaseMs: 30 });
    r.acquire("c");
    r.join("c");
    expect(r.joined().sort()).toEqual(["a", "b", "c"]);
    r.put("z", 2);
    // may or may not migrate depending on ownership shift; drain safe either way
    if (r.pending().length) r.drain();
    expect(r.get("z")).toBe(2);
  });

  test("interleave: leave then drive empty ops idempotent-ish", () => {
    const clock = new VirtualClock();
    const v = make(clock, { leaseMs: 5 });
    const a = v.acquire("a");
    v.join("a");
    v.leave("a");
    v.release("a", a.fence);
    const n = v.journal().length;
    expect(v.drive()).toEqual([]);
    expect(v.journal().length).toBe(n);
  });

  test("failed renew without lease does not append wal", () => {
    const clock = new VirtualClock();
    const v = make(clock);
    const n = v.journal().length;
    expect(() => v.renew("ghost", 1)).toThrow(LeaseError);
    expect(v.journal().length).toBe(n);
  });

  test("deterministic owners across instances", () => {
    const c1 = new VirtualClock();
    const c2 = new VirtualClock();
    const v1 = make(c1);
    const v2 = make(c2);
    for (const n of ["a", "b", "c"]) {
      v1.acquire(n);
      v1.join(n);
      v2.acquire(n);
      v2.join(n);
    }
    for (let i = 0; i < 20; i++) {
      const k = `d${i}`;
      expect(v1.vnodeOf(k)).toBe(v2.vnodeOf(k));
      expect(v1.ownerOf(k)).toBe(v2.ownerOf(k));
    }
  });
});
