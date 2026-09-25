import { OutboxEngine, VirtualClock } from "../src/index.js";

function setup(opts?: {
  visibilityTimeout?: number;
  retryBackoff?: number[];
}) {
  const clock = new VirtualClock();
  const eng = new OutboxEngine({
    clock,
    visibilityTimeout: opts?.visibilityTimeout ?? 10,
    retryBackoff: opts?.retryBackoff ?? [5, 10, 20],
  });
  return { clock, eng };
}

describe("txoutbox", () => {
  test("domain write visible after commit", () => {
    const { eng } = setup();
    eng.commitWrite({
      key: "user:1",
      value: "alice",
      messageId: "m1",
      payload: "created",
    });
    expect(eng.domainGet("user:1")).toBe("alice");
  });

  test("message eventually delivered on tick", () => {
    const { eng } = setup();
    eng.subscribe("c1", () => {});
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "p1",
    });
    eng.tick();
    expect(eng.effects("c1")).toEqual(["p1"]);
    expect(eng.outboxStats().published).toBe(1);
  });

  test("per-key ordering preserved under concurrent enqueue", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [0],
    });
    const seen: string[] = [];
    let releaseFirst = false;
    eng.subscribe("c1", (msg) => {
      seen.push(msg.payload);
      if (msg.payload === "first" && !releaseFirst) {
        throw new Error("hold-first");
      }
    });

    eng.commitWrite({
      key: "order",
      value: "1",
      messageId: "a",
      payload: "first",
    });
    eng.commitWrite({
      key: "order",
      value: "2",
      messageId: "b",
      payload: "second",
    });

    eng.tick();
    expect(seen).toContain("first");
    expect(seen).not.toContain("second");
    expect(eng.effects("c1")).toEqual([]);

    releaseFirst = true;
    clock.advance(10);
    eng.tick();
    expect(eng.effects("c1")).toEqual(["first", "second"]);
  });

  test("different keys not blocked by each other", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [0],
    });
    const seen: string[] = [];
    eng.subscribe("c1", (msg) => {
      seen.push(msg.payload);
      if (msg.key === "slow") throw new Error("slow-busy");
    });

    eng.commitWrite({
      key: "slow",
      value: "1",
      messageId: "s1",
      payload: "slow-1",
    });
    eng.commitWrite({
      key: "fast",
      value: "1",
      messageId: "f1",
      payload: "fast-1",
    });

    eng.tick();
    expect(seen).toContain("fast-1");
    expect(eng.effects("c1")).toContain("fast-1");
    clock.advance(0);
  });

  test("duplicate messageId no second outbox row and no double effect", () => {
    const { eng } = setup();
    eng.subscribe("c1", () => {});
    eng.commitWrite({
      key: "k",
      value: "v1",
      messageId: "dup",
      payload: "p1",
    });
    eng.commitWrite({
      key: "k",
      value: "v2",
      messageId: "dup",
      payload: "p2",
    });
    expect(eng.domainGet("k")).toBe("v1");
    eng.tick();
    const stats = eng.outboxStats();
    expect(stats.pending + stats.inFlight + stats.published).toBe(1);
    expect(eng.effects("c1")).toEqual(["p1"]);
  });

  test("consumer duplicate delivery deduped", () => {
    const { eng } = setup();
    eng.subscribe("c1", () => {});
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "once",
    });
    eng.tick();
    expect(eng.effects("c1")).toEqual(["once"]);
    eng.tick();
    eng.tick();
    expect(eng.effects("c1")).toEqual(["once"]);
  });

  test("visibility timeout reclaims in_flight", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [0],
    });
    let allow = false;
    eng.subscribe("c1", () => {
      if (!allow) throw new Error("wait");
    });
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "p1",
    });
    eng.tick();
    expect(eng.outboxStats().inFlight).toBe(1);
    expect(eng.effects("c1")).toEqual([]);

    allow = true;
    clock.advance(11);
    eng.tick();
    expect(eng.effects("c1")).toEqual(["p1"]);
    expect(eng.outboxStats().published).toBe(1);
  });

  test("retry after failure then success", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [5, 10, 20],
    });
    let fail = true;
    eng.subscribe("c1", () => {
      if (fail) {
        fail = false;
        throw new Error("boom");
      }
    });
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "p1",
    });
    eng.tick();
    expect(eng.effects("c1")).toEqual([]);
    clock.advance(10);
    eng.tick();
    clock.advance(5);
    eng.tick();
    expect(eng.effects("c1")).toEqual(["p1"]);
  });

  test("crash after publish-in-flight recover no double effect", () => {
    const { eng } = setup();
    eng.subscribe("c1", () => {});
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "p1",
    });
    eng.tick();
    expect(eng.effects("c1")).toEqual(["p1"]);
    eng.crash();
    eng.recover();
    eng.tick();
    expect(eng.effects("c1")).toEqual(["p1"]);
  });

  test("crash before publish recover still delivers once effect", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [0],
    });
    let fail = true;
    eng.subscribe("c1", () => {
      if (fail) throw new Error("not-yet");
    });
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "p1",
    });
    eng.tick();
    expect(eng.effects("c1")).toEqual([]);
    expect(eng.outboxStats().inFlight).toBe(1);

    eng.crash();
    fail = false;
    eng.recover();
    clock.advance(10);
    eng.tick();
    expect(eng.effects("c1")).toEqual(["p1"]);
  });

  test("exact visibility boundary reclaims at equality", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [0],
    });
    let allow = false;
    eng.subscribe("c1", () => {
      if (!allow) throw new Error("wait");
    });
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "b1",
      payload: "x",
    });
    eng.tick();
    expect(eng.outboxStats().inFlight).toBe(1);

    allow = true;
    clock.advance(10);
    eng.tick();
    expect(eng.effects("c1")).toEqual(["x"]);
  });

  test("outboxStats counts", () => {
    const { eng } = setup();
    eng.subscribe("c1", () => {});
    eng.commitWrite({
      key: "a",
      value: "1",
      messageId: "m1",
      payload: "p1",
    });
    eng.commitWrite({
      key: "b",
      value: "2",
      messageId: "m2",
      payload: "p2",
    });
    expect(eng.outboxStats()).toEqual({
      pending: 2,
      inFlight: 0,
      published: 0,
    });
    eng.tick();
    expect(eng.outboxStats()).toEqual({
      pending: 0,
      inFlight: 0,
      published: 2,
    });
  });

  test("multi consumer independent inbox", () => {
    const { eng } = setup();
    eng.subscribe("c1", () => {});
    eng.subscribe("c2", () => {});
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "shared",
      payload: "hello",
    });
    eng.tick();
    expect(eng.effects("c1")).toEqual(["hello"]);
    expect(eng.effects("c2")).toEqual(["hello"]);
  });

  test("backoff waits virtual time", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [5, 10, 20],
    });
    let fail = true;
    eng.subscribe("c1", () => {
      if (fail) {
        fail = false;
        throw new Error("boom");
      }
    });
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "p1",
    });
    eng.tick();
    expect(eng.effects("c1")).toEqual([]);

    clock.advance(10);
    eng.tick();
    expect(eng.effects("c1")).toEqual([]);

    clock.advance(4);
    eng.tick();
    expect(eng.effects("c1")).toEqual([]);

    clock.advance(1);
    eng.tick();
    expect(eng.effects("c1")).toEqual(["p1"]);
  });

  test("pending survives crash before any tick", () => {
    const { eng } = setup();
    eng.subscribe("c1", () => {});
    eng.commitWrite({
      key: "k",
      value: "v",
      messageId: "m1",
      payload: "p1",
    });
    eng.crash();
    eng.recover();
    eng.tick();
    expect(eng.domainGet("k")).toBe("v");
    expect(eng.effects("c1")).toEqual(["p1"]);
  });

  test("same key blocked until prior published across ticks", () => {
    const { clock, eng } = setup({
      visibilityTimeout: 10,
      retryBackoff: [0],
    });
    const seen: string[] = [];
    let releaseFirst = false;
    eng.subscribe("c1", (msg) => {
      seen.push(msg.payload);
      if (msg.payload === "first" && !releaseFirst) {
        throw new Error("hold-first");
      }
    });
    eng.commitWrite({
      key: "k",
      value: "1",
      messageId: "m1",
      payload: "first",
    });
    eng.commitWrite({
      key: "k",
      value: "2",
      messageId: "m2",
      payload: "second",
    });
    eng.tick();
    expect(seen.filter((x) => x === "second")).toHaveLength(0);

    releaseFirst = true;
    clock.advance(10);
    eng.tick();
    expect(eng.effects("c1")).toEqual(["first", "second"]);
  });
});
