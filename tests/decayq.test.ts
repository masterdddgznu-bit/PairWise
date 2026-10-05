import {
  CapacityError,
  DecayQ,
  InvalidConfigError,
  InvalidIdError,
  InvalidScoreError,
  UnknownTenantError,
  VirtualClock,
} from "../src/index.js";

function setup(over?: Partial<{
  maxItems: number;
  decayPerMs: number;
  defaultTtlMs: number;
  tenants: { id: string; maxInflight: number; maxPops?: number }[];
}>) {
  const clock = new VirtualClock();
  const q = new DecayQ({
    clock,
    decayPerMs: over?.decayPerMs ?? 1,
    maxItems: over?.maxItems ?? 8,
    defaultTtlMs: over?.defaultTtlMs ?? 100,
    tenants: over?.tenants ?? [
      { id: "t1", maxInflight: 1, maxPops: 10 },
      { id: "t2", maxInflight: 1, maxPops: 10 },
    ],
  });
  return { clock, q };
}

describe("decayq hell", () => {
  test("invalid config", () => {
    const clock = new VirtualClock();
    expect(() => new DecayQ({ clock, decayPerMs: -1, tenants: [{ id: "a", maxInflight: 1 }] })).toThrow(InvalidConfigError);
    expect(() => new DecayQ({ clock, decayPerMs: 0, tenants: [] })).toThrow(InvalidConfigError);
  });

  test("enqueue and decay ranking", () => {
    const { clock, q } = setup({ decayPerMs: 1 });
    q.enqueue("a", "t1", 1, 100);
    clock.advance(10);
    q.enqueue("b", "t2", 1, 95);
    // a effective 90, b 95 -> peek b
    expect(q.peek()?.id).toBe("b");
    expect(q.effectiveScore("a")).toBe(90);
  });

  test("unknown tenant and bad score duplicate id", () => {
    const { q } = setup();
    expect(() => q.enqueue("a", "nope", 1, 1)).toThrow(UnknownTenantError);
    expect(() => q.enqueue("a", "t1", 1, Number.NaN)).toThrow(InvalidScoreError);
    q.enqueue("a", "t1", 1, 1);
    expect(() => q.enqueue("a", "t1", 1, 2)).toThrow(InvalidIdError);
  });

  test("capacity throws and does not deadletter", () => {
    const { q } = setup({ maxItems: 1 });
    q.enqueue("a", "t1", 1, 1);
    expect(() => q.enqueue("b", "t1", 1, 1)).toThrow(CapacityError);
    expect(q.deadLetterIds()).toEqual([]);
  });

  test("tenant inflight blocks higher score then allows lower other tenant", () => {
    const { clock, q } = setup({
      decayPerMs: 0,
      tenants: [
        { id: "t1", maxInflight: 1 },
        { id: "t2", maxInflight: 1 },
      ],
    });
    q.enqueue("hi", "t1", 1, 100);
    q.enqueue("lo", "t2", 1, 1);
    clock.advance(1);
    expect(q.pop()?.id).toBe("hi");
    expect(q.inflightOf("t1")).toBe(1);
    // t1 blocked; lo can pop
    expect(q.pop()?.id).toBe("lo");
    expect(q.pop()).toBeNull();
  });

  test("maxPops exhaust skips tenant items", () => {
    const { clock, q } = setup({
      decayPerMs: 0,
      tenants: [
        { id: "t1", maxInflight: 2, maxPops: 1 },
        { id: "t2", maxInflight: 2, maxPops: 5 },
      ],
    });
    q.enqueue("a", "t1", 1, 50);
    q.enqueue("b", "t1", 1, 40);
    q.enqueue("c", "t2", 1, 10);
    clock.advance(1);
    expect(q.pop()?.id).toBe("a");
    expect(q.complete("a")).toBe(true);
    // t1 pops exhausted; b skipped by quota; c pops
    expect(q.pop()?.id).toBe("c");
    // peek/pop both skip quota-blocked b
    expect(q.peek()).toBeNull();
    expect(q.ids()).toEqual(["b"]);
    expect(q.pop()).toBeNull();
  });

  test("pump expires queued not inflight", () => {
    const { clock, q } = setup({ defaultTtlMs: 5, decayPerMs: 0 });
    q.enqueue("a", "t1", 1, 10, 5);
    q.enqueue("b", "t2", 1, 9, 5);
    expect(q.pop()?.id).toBe("a");
    clock.advance(5);
    const { expired } = q.pump();
    expect(expired).toEqual(["b"]);
    expect(q.deadReason("b")).toBe("expired");
    expect(q.size()).toBe(0);
    expect(q.complete("a")).toBe(true);
  });

  test("cancel queued frees slot; inflight cancel false", () => {
    const { q } = setup({ maxItems: 1 });
    q.enqueue("a", "t1", 1, 1);
    expect(q.cancel("a")).toBe(true);
    expect(q.size()).toBe(0);
    q.enqueue("b", "t1", 1, 1);
    expect(q.pop()?.id).toBe("b");
    expect(q.cancel("b")).toBe(false);
  });

  test("refuseQuota deadletter and reclaim", () => {
    const { clock, q } = setup({ maxItems: 2, defaultTtlMs: 20, decayPerMs: 0 });
    q.enqueue("a", "t1", 1, 1);
    expect(q.refuseQuota("a")).toBe(true);
    expect(q.deadReason("a")).toBe("quota_refuse");
    expect(q.size()).toBe(0);
    expect(q.reclaim("a")).toBe(true);
    expect(q.ids()).toEqual(["a"]);
    expect(q.deadLetterIds()).toEqual([]);
    clock.advance(1);
    expect(q.effectiveScore("a")).toBe(1);
  });

  test("reclaim fails when capacity full leaves item in dead", () => {
    const { q } = setup({ maxItems: 1, decayPerMs: 0 });
    q.enqueue("a", "t1", 1, 1);
    q.refuseQuota("a");
    q.enqueue("b", "t1", 1, 1);
    expect(q.reclaim("a")).toBe(false);
    expect(q.deadLetterIds()).toContain("a");
  });

  test("drive limit with decay and complete recycle inflight", () => {
    const { clock, q } = setup({
      decayPerMs: 1,
      tenants: [{ id: "t1", maxInflight: 1, maxPops: 10 }],
    });
    q.enqueue("a", "t1", 1, 30);
    clock.advance(5);
    q.enqueue("b", "t1", 1, 30);
    // a eff 25, b 30
    const d1 = q.drive(1);
    expect(d1.drained.map((x) => x.id)).toEqual(["b"]);
    expect(q.drive(1).drained).toEqual([]);
    q.complete("b");
    expect(q.pop()?.id).toBe("a");
  });

  test("tie-break earlier enqueuedAt wins when scores equal", () => {
    const { clock, q } = setup({ decayPerMs: 0 });
    q.enqueue("a", "t1", 1, 10);
    clock.advance(0);
    q.enqueue("b", "t2", 1, 10);
    expect(q.peek()?.id).toBe("a");
  });

  test("multi-step: expire then reclaim then pop under quota", () => {
    const { clock, q } = setup({
      defaultTtlMs: 3,
      decayPerMs: 0,
      tenants: [
        { id: "t1", maxInflight: 1, maxPops: 2 },
        { id: "t2", maxInflight: 1 },
      ],
    });
    q.enqueue("x", "t1", "x", 5, 3);
    clock.advance(3);
    expect(q.pump().expired).toEqual(["x"]);
    expect(q.reclaim("x")).toBe(true);
    q.enqueue("y", "t1", "y", 100);
    expect(q.pop()?.id).toBe("y");
    expect(q.pop()).toBeNull(); // inflight full
    q.complete("y");
    expect(q.pop()?.id).toBe("x");
  });

  test("multi-step: decay crosses fairness with blocked tenant", () => {
    const { clock, q } = setup({
      decayPerMs: 2,
      tenants: [
        { id: "t1", maxInflight: 1, maxPops: 1 },
        { id: "t2", maxInflight: 1, maxPops: 5 },
      ],
    });
    q.enqueue("a", "t1", 1, 100);
    q.enqueue("b", "t2", 1, 90);
    clock.advance(10);
    // a eff 80, b 70 — pop a
    expect(q.pop()?.id).toBe("a");
    q.complete("a");
    // t1 pops done; a gone; b still; c higher score but blocked by maxPops
    q.enqueue("c", "t1", 1, 1000);
    expect(q.peek()?.id).toBe("b");
    expect(q.pop()?.id).toBe("b");
    expect(q.refuseQuota("c")).toBe(true);
    expect(q.deadReason("c")).toBe("quota_refuse");
  });

  test("multi-step: implicit sweep on enqueue after ttl", () => {
    const { clock, q } = setup({ maxItems: 1, defaultTtlMs: 2, decayPerMs: 0 });
    q.enqueue("old", "t1", 1, 1, 2);
    clock.advance(2);
    q.enqueue("new", "t2", 1, 1);
    expect(q.ids()).toEqual(["new"]);
    expect(q.deadLetterIds()).toEqual(["old"]);
  });

  test("multi-step: drive drains across tenants after completes", () => {
    const { clock, q } = setup({
      decayPerMs: 0,
      tenants: [
        { id: "t1", maxInflight: 1 },
        { id: "t2", maxInflight: 1 },
      ],
    });
    q.enqueue("a", "t1", 1, 3);
    q.enqueue("b", "t2", 1, 2);
    q.enqueue("c", "t1", 1, 1);
    clock.advance(1);
    expect(q.drive().drained.map((d) => d.id)).toEqual(["a", "b"]);
    q.complete("a");
    expect(q.pop()?.id).toBe("c");
  });

  test("multi-step: cancel-after-partial-decay and re-enqueue same logical slot", () => {
    const { clock, q } = setup({ decayPerMs: 1, maxItems: 2 });
    q.enqueue("a", "t1", 1, 50);
    clock.advance(20);
    expect(q.effectiveScore("a")).toBe(30);
    expect(q.cancel("a")).toBe(true);
    q.enqueue("a", "t2", 2, 10);
    clock.advance(5);
    expect(q.pop()?.tenantId).toBe("t2");
  });
});
