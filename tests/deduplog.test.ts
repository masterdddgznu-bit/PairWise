import { VirtualClock, DedupLog } from "../src/index.js";

function log(ttlMs = 100) {
  const clock = new VirtualClock();
  return {
    clock,
    dl: new DedupLog(clock, { ttlMs }),
    ttlMs,
  };
}

describe("deduplog idempotent ingest", () => {
  test("accept first time returns true", () => {
    const { dl } = log();
    expect(dl.accept("t1", "evt-1")).toBe(true);
  });

  test("duplicate while unexpired returns false", () => {
    const { dl } = log();
    expect(dl.accept("t1", "dup")).toBe(true);
    expect(dl.accept("t1", "dup")).toBe(false);
  });

  test("has true immediately after accept", () => {
    const { dl } = log();
    dl.accept("t1", "seen");
    expect(dl.has("t1", "seen")).toBe(true);
  });

  test("seenAt returns ingest timestamp", () => {
    const { clock, dl } = log();
    clock.advance(5);
    dl.accept("t1", "ts");
    expect(dl.seenAt("t1", "ts")).toBe(5);
  });

  test("different ids under same tenant are independent", () => {
    const { dl } = log();
    expect(dl.accept("t1", "a")).toBe(true);
    expect(dl.accept("t1", "b")).toBe(true);
    expect(dl.has("t1", "a")).toBe(true);
    expect(dl.has("t1", "b")).toBe(true);
  });

  test("export empty state and import into fresh log", () => {
    const { clock, dl } = log();
    const snap = dl.exportState();
    const dl2 = new DedupLog(clock, { ttlMs: 100 });
    dl2.importState(snap);
    expect(dl2.accept("t1", "fresh")).toBe(true);
  });

  test("clearTenant on unknown tenant is safe", () => {
    const { dl } = log();
    expect(() => dl.clearTenant("nobody")).not.toThrow();
    expect(dl.accept("someone", "k")).toBe(true);
  });

  test("size zero on fresh log", () => {
    const { dl } = log();
    expect(dl.size()).toBe(0);
  });

  test("gc on empty log is safe", () => {
    const { dl } = log();
    expect(() => dl.gc()).not.toThrow();
    expect(dl.size()).toBe(0);
  });

  test("accept again after TTL elapsed returns true", () => {
    const { clock, dl, ttlMs } = log();
    expect(dl.accept("t1", "cycle")).toBe(true);
    clock.advance(ttlMs + 1);
    expect(dl.accept("t1", "cycle")).toBe(true);
  });

  test("exact expiry boundary allows re-accept", () => {
    const { clock, dl, ttlMs } = log(80);
    expect(dl.accept("t1", "edge")).toBe(true);
    clock.advance(ttlMs);
    expect(dl.has("t1", "edge")).toBe(false);
    expect(dl.accept("t1", "edge")).toBe(true);
  });

  test("has false once clock reaches expiry exactly", () => {
    const { clock, dl, ttlMs } = log(60);
    dl.accept("t1", "exp");
    clock.advance(ttlMs);
    expect(dl.has("t1", "exp")).toBe(false);
  });

  test("seenAt undefined after expiry", () => {
    const { clock, dl, ttlMs } = log(50);
    dl.accept("t1", "gone");
    clock.advance(ttlMs + 1);
    expect(dl.seenAt("t1", "gone")).toBeUndefined();
  });

  test("tenants isolated on same id name", () => {
    const { dl } = log();
    expect(dl.accept("tenant-a", "shared-id")).toBe(true);
    expect(dl.accept("tenant-b", "shared-id")).toBe(true);
    expect(dl.has("tenant-a", "shared-id")).toBe(true);
    expect(dl.has("tenant-b", "shared-id")).toBe(true);
  });

  test("duplicate accept does not extend TTL window", () => {
    const { clock, dl, ttlMs } = log(100);
    expect(dl.accept("t1", "stay")).toBe(true);
    clock.advance(70);
    expect(dl.accept("t1", "stay")).toBe(false);
    clock.advance(35);
    expect(dl.has("t1", "stay")).toBe(false);
    expect(dl.accept("t1", "stay")).toBe(true);
  });

  test("gc drops expired entries from queries", () => {
    const { clock, dl, ttlMs } = log(40);
    dl.accept("t1", "gc-me");
    clock.advance(ttlMs + 5);
    dl.gc();
    expect(dl.has("t1", "gc-me")).toBe(false);
    expect(dl.size()).toBe(0);
  });

  test("size excludes expired records", () => {
    const { clock, dl, ttlMs } = log(30);
    dl.accept("t1", "a");
    dl.accept("t1", "b");
    clock.advance(ttlMs + 1);
    expect(dl.size()).toBe(0);
  });

  test("clearTenant removes all ids for tenant only", () => {
    const { dl } = log();
    dl.accept("t1", "x");
    dl.accept("t1", "y");
    dl.accept("t2", "z");
    dl.clearTenant("t1");
    expect(dl.has("t1", "x")).toBe(false);
    expect(dl.has("t1", "y")).toBe(false);
    expect(dl.has("t2", "z")).toBe(true);
    expect(dl.size("t1")).toBe(0);
    expect(dl.size("t2")).toBe(1);
  });

  test("export import roundtrip preserves historical timestamps", () => {
    const { clock, dl, ttlMs } = log(100);
    clock.advance(20);
    dl.accept("t1", "hist");
    const snap = dl.exportState();
    const dl2 = new DedupLog(clock, { ttlMs });
    dl2.importState(snap);
    expect(dl2.seenAt("t1", "hist")).toBe(20);
    clock.advance(70);
    expect(dl2.has("t1", "hist")).toBe(true);
    clock.advance(35);
    expect(dl2.has("t1", "hist")).toBe(false);
  });

  test("import does not resurrect expired entries as live", () => {
    const { clock, dl, ttlMs } = log(60);
    dl.importState({
      entries: [{ tenant: "t1", id: "stale", seenAt: 10 }],
    });
    clock.advance(100);
    expect(dl.has("t1", "stale")).toBe(false);
    expect(dl.accept("t1", "stale")).toBe(true);
  });

  test("lazy gc on accept removes stale before insert", () => {
    const { clock, dl, ttlMs } = log(50);
    dl.accept("t1", "old");
    clock.advance(30);
    dl.accept("t1", "keep");
    clock.advance(25);
    expect(dl.accept("t1", "new")).toBe(true);
    expect(dl.size()).toBe(2);
    expect(dl.has("t1", "old")).toBe(false);
    expect(dl.has("t1", "keep")).toBe(true);
    expect(dl.has("t1", "new")).toBe(true);
  });

  test("size with tenant filter counts only that tenant", () => {
    const { dl } = log();
    dl.accept("alpha", "1");
    dl.accept("alpha", "2");
    dl.accept("beta", "1");
    expect(dl.size("alpha")).toBe(2);
    expect(dl.size("beta")).toBe(1);
    expect(dl.size()).toBe(3);
  });
});
