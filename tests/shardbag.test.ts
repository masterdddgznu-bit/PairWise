import {
  VirtualClock,
  ShardBag,
  fnv1aShard,
  InvalidConfigError,
  InvalidJobError,
  UnknownTicketError,
  FenceError,
} from "../src/index.js";

function bag(
  o: Partial<{
    shardCount: number;
    leaseMs: number;
    maxPerShard: number;
  }> = {},
) {
  const clock = new VirtualClock();
  const b = new ShardBag({
    clock,
    shardCount: o.shardCount ?? 3,
    leaseMs: o.leaseMs ?? 10,
    maxPerShard: o.maxPerShard ?? 8,
  });
  return { clock, b };
}

describe("shardbag hell 0-1", () => {
  test("rejects bad config", () => {
    const clock = new VirtualClock();
    expect(
      () => new ShardBag({ clock, shardCount: 0, leaseMs: 1 }),
    ).toThrow(InvalidConfigError);
  });

  test("fnv1aShard stable", () => {
    expect(fnv1aShard("alpha", 3)).toBe(fnv1aShard("alpha", 3));
    expect(() => fnv1aShard("", 3)).toThrow(InvalidJobError);
    const a = fnv1aShard("a", 3);
    const b = fnv1aShard("b", 3);
    const c = fnv1aShard("c", 3);
    expect([a, b, c].every((x) => x >= 0 && x < 3)).toBe(true);
  });

  test("enqueue claim complete on hashed shard", () => {
    const { b } = bag();
    const t = b.enqueue("alpha", "p");
    expect(b.shardOf(t)).toBe(fnv1aShard("alpha", 3));
    const c = b.claim()!;
    expect(c.ticket).toBe(t);
    expect(c.key).toBe("alpha");
    expect(b.complete(c.ticket, c.fence)).toBe(true);
    expect(b.status(t)).toBe("done");
  });

  test("round-robin claim across shards", () => {
    const { b } = bag({ shardCount: 3 });
    // find three keys on distinct shards
    const keys: string[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < 100 && keys.length < 3; i++) {
      const k = `k${i}`;
      const s = fnv1aShard(k, 3);
      if (!seen.has(s)) {
        seen.add(s);
        keys.push(k);
      }
    }
    expect(keys).toHaveLength(3);
    for (const k of keys) b.enqueue(k, k);
    const s1 = b.claim()!.shard;
    const s2 = b.claim()!.shard;
    const s3 = b.claim()!.shard;
    expect(new Set([s1, s2, s3]).size).toBe(3);
    // cursor advanced past last claimed shard
    expect(b.cursor()).toBe((s3 + 1) % 3);
  });

  test("same shard priority then ticket", () => {
    const { b } = bag({ shardCount: 1 });
    b.enqueue("x", "a", { priority: 1 });
    b.enqueue("x", "b", { priority: 5 });
    b.enqueue("x", "c", { priority: 5 });
    expect(b.claim()!.payload).toBe("b");
    expect(b.claim()!.payload).toBe("c");
    expect(b.claim()!.payload).toBe("a");
  });

  test("fail returns to same shard ready", () => {
    const { b } = bag({ shardCount: 3 });
    const t = b.enqueue("zz", "p");
    const sh = b.shardOf(t);
    const c = b.claim()!;
    expect(b.fail(c.ticket, c.fence)).toBe(true);
    expect(b.status(t)).toBe("ready");
    expect(b.shardOf(t)).toBe(sh);
    expect(b.readyOn(sh)).toContain(t);
  });

  test("lease expiry requeues; stale fence", () => {
    const { clock, b } = bag({ leaseMs: 4 });
    b.enqueue("k", "p");
    const c = b.claim()!;
    clock.advance(4);
    expect(b.drive().requeued).toEqual([c.ticket]);
    expect(() => b.complete(c.ticket, c.fence)).toThrow(FenceError);
    const c2 = b.claim()!;
    expect(c2.ticket).toBe(c.ticket);
    expect(c2.fence).not.toBe(c.fence);
  });

  test("delay then becameReady", () => {
    const { clock, b } = bag();
    const t = b.enqueue("k", "p", { delayMs: 7 });
    expect(b.claim()).toBeUndefined();
    clock.advance(7);
    expect(b.drive().becameReady).toEqual([t]);
    expect(b.claim()!.ticket).toBe(t);
  });

  test("maxPerShard", () => {
    const { b } = bag({ shardCount: 1, maxPerShard: 2 });
    b.enqueue("a", "1");
    b.enqueue("a", "2");
    expect(() => b.enqueue("a", "3")).toThrow(InvalidJobError);
  });

  test("cancel and unknown", () => {
    const { b } = bag();
    const t = b.enqueue("k", "p");
    expect(b.cancel(t)).toBe(true);
    expect(b.status(t)).toBe("cancelled");
    expect(() => b.status(9)).toThrow(UnknownTicketError);
  });

  test("heartbeat extends lease", () => {
    const { clock, b } = bag({ leaseMs: 5 });
    b.enqueue("k", "p");
    const c = b.claim()!;
    clock.advance(4);
    expect(b.heartbeat(c.ticket, c.fence)).toBe(true);
    clock.advance(4);
    expect(b.drive().requeued).toEqual([]);
  });

  test("fairness: busy shard does not starve others when cursor rotates", () => {
    const { b } = bag({ shardCount: 2 });
    // put many on shard 0 and one on shard 1
    const k0: string[] = [];
    let k1: string | null = null;
    for (let i = 0; i < 200; i++) {
      const k = `n${i}`;
      const s = fnv1aShard(k, 2);
      if (s === 0 && k0.length < 3) k0.push(k);
      if (s === 1 && !k1) k1 = k;
    }
    expect(k0.length).toBe(3);
    expect(k1).toBeTruthy();
    for (const k of k0) b.enqueue(k, k);
    b.enqueue(k1!, "lonely");
    const first = b.claim()!;
    const second = b.claim()!;
    const shards = new Set([first.shard, second.shard]);
    expect(shards.size).toBe(2);
  });

  test("clock negative throws", () => {
    const clock = new VirtualClock();
    expect(() => clock.advance(-1)).toThrow();
  });

  test("cursor unchanged when claim empty", () => {
    const { b } = bag();
    expect(b.cursor()).toBe(0);
    expect(b.claim()).toBeUndefined();
    expect(b.cursor()).toBe(0);
  });
});
