import {
  DuplicateTaskError,
  InvalidConfigError,
  InvalidTaskError,
  TaskMesh,
  UnknownTaskError,
  VirtualClock,
} from "../src/index.js";

function make(leaseMs = 50, maxAttempts = 2) {
  const clock = new VirtualClock();
  const m = new TaskMesh({ clock, leaseMs, maxAttempts });
  return { clock, m };
}

describe("taskmesh config", () => {
  test("bad config", () => {
    const clock = new VirtualClock();
    expect(() => new TaskMesh({ clock, leaseMs: 0 })).toThrow(InvalidConfigError);
    expect(() => new TaskMesh({ clock, leaseMs: 10, maxAttempts: 0 })).toThrow(
      InvalidConfigError,
    );
  });
});

describe("deps readiness and claim order", () => {
  test("pending until deps succeed; claim lexicographically", () => {
    const { m } = make();
    m.submit("b");
    m.submit("a", { deps: ["b"] });
    expect(m.status("a")).toBe("pending");
    expect(m.readyIds()).toEqual(["b"]);
    expect(m.claim("w1")).toEqual({ id: "b", payload: "", attempt: 1 });
    expect(m.complete("w1", "b")).toBe(true);
    expect(m.status("a")).toBe("ready");
    expect(m.claim("w2")?.id).toBe("a");
  });

  test("unknown dep and cycle rejected", () => {
    const { m } = make();
    expect(() => m.submit("x", { deps: ["nope"] })).toThrow(InvalidTaskError);
    m.submit("p");
    m.submit("q", { deps: ["p"] });
    expect(() => m.submit("p2", { deps: ["q"] })).not.toThrow();
    // create cycle r->s->r
    m.submit("r");
    expect(() => m.submit("s", { deps: ["r"] })).not.toThrow();
    // adding edge back via new task that closes cycle through re-submit not allowed — submit t deps s, then cannot submit u that makes cycle
    // direct: submit a deps [b], submit b deps [a] — second should fail
    const { m: m2 } = make();
    m2.submit("a");
    m2.submit("b", { deps: ["a"] });
    expect(() => m2.submit("c", { deps: ["b", "a"] })).not.toThrow();
    const { m: m3 } = make();
    m3.submit("a", { deps: [] });
    expect(() => {
      m3.submit("b", { deps: ["a"] });
      // mutate graph with task that depends on b while a depends on b — need a depend on b after b exists
    }).not.toThrow();
    const { m: m4 } = make();
    m4.submit("x");
    m4.submit("y", { deps: ["x"] });
    expect(() => m4.submit("x2", { deps: ["y"] })).not.toThrow();
    // cycle: m5
    const { m: m5 } = make();
    m5.submit("a");
    m5.submit("b", { deps: ["a"] });
    expect(() => m5.submit("a")).toThrow(DuplicateTaskError);
    // The cycle case: submit a; submit b deps a; cannot submit c deps b and also have a deps c — a already submitted.
    // Cycle only possible if we allow submit with deps forming cycle in one go: a deps [b], but b not submitted.
    // So cycle detection: submit a; submit b deps [a]; submit c deps [b]; try submit d deps [c, a] ok; 
    // Real cycle: three nodes submitted with mutual deps — e.g. after a,b ready, we need submit that references...
    // Allow: submit("p"); submit("q", {deps:["p"]}); — to cycle, would need update. 
    // Spec says submit detects cycle — so submit a deps [b] when b deps [a] already:
    const { m: cy } = make();
    cy.submit("b");
    cy.submit("a", { deps: ["b"] });
    // Now if we could add b->a but b exists. Alternative cycle in one submit batch isn't available.
    // Multi-edge cycle via new node: a<-b<-c<-a impossible without changing a.
    // Test: submit with self-dep
    const { m: self } = make();
    expect(() => self.submit("z", { deps: ["z"] })).toThrow(InvalidTaskError);
  });
});

describe("lease fail retry cancel cascade", () => {
  test("lease exclusive complete; fail retries then dead", () => {
    const { m } = make(50, 2);
    m.submit("t", { payload: "p" });
    const c1 = m.claim("w");
    expect(c1).toEqual({ id: "t", payload: "p", attempt: 1 });
    expect(m.claim("w2")).toBeUndefined();
    expect(m.complete("w2", "t")).toBe(false);
    expect(m.fail("w", "t")).toBe(true);
    expect(m.status("t")).toBe("ready");
    expect(m.claim("w")?.attempt).toBe(2);
    expect(m.fail("w", "t")).toBe(true);
    expect(m.status("t")).toBe("failed");
    expect(m.claim("w")).toBeUndefined();
  });

  test("lease timeout returns to ready without burning attempt", () => {
    const { clock, m } = make(50, 3);
    m.submit("t");
    expect(m.claim("w")?.attempt).toBe(1);
    clock.advance(50);
    expect(m.drive()).toEqual([]);
    expect(m.status("t")).toBe("ready");
    expect(m.claim("w2")?.attempt).toBe(1);
    expect(m.heartbeat("w2", "t")).toBe(true);
    clock.advance(49);
    expect(m.heartbeat("w2", "t")).toBe(true);
    clock.advance(50);
    m.drive();
    expect(m.status("t")).toBe("ready");
  });

  test("cancel cascades to dependents not to succeeded deps", () => {
    const { m } = make();
    m.submit("root");
    m.submit("mid", { deps: ["root"] });
    m.submit("leaf", { deps: ["mid"] });
    m.submit("other");
    const c = m.claim("w");
    expect(c?.id).toBe("other");
    m.complete("w", "other");
    const cancelled = m.cancel("root");
    expect(cancelled).toEqual(["leaf", "mid", "root"]);
    expect(m.status("other")).toBe("succeeded");
    expect(m.status("mid")).toBe("cancelled");
    expect(m.claim("w")).toBeUndefined();
  });

  test("cancel running blocks complete", () => {
    const { m } = make();
    m.submit("t");
    m.claim("w");
    expect(m.cancel("t")).toEqual(["t"]);
    expect(m.complete("w", "t")).toBe(false);
    expect(m.fail("w", "t")).toBe(false);
  });
});

describe("deadline and graph wakeups", () => {
  test("deadline fails open tasks via drive", () => {
    const { clock, m } = make(100, 2);
    m.submit("a", { deadlineMs: 30 });
    m.submit("b", { deps: ["a"], deadlineMs: 1000 });
    clock.advance(30);
    expect(m.drive()).toEqual(["a"]);
    expect(m.status("a")).toBe("failed");
    expect(m.status("b")).toBe("pending");
  });

  test("multi dep readiness and duplicate submit", () => {
    const { m } = make();
    m.submit("d1");
    m.submit("d2");
    m.submit("x", { deps: ["d1", "d2"] });
    m.claim("w");
    m.complete("w", "d1");
    expect(m.status("x")).toBe("pending");
    m.claim("w");
    m.complete("w", "d2");
    expect(m.status("x")).toBe("ready");
    expect(() => m.submit("x")).toThrow(DuplicateTaskError);
    expect(() => m.status("no")).toThrow(UnknownTaskError);
  });

  test("heartbeat wrong worker false; claim payload preserved", () => {
    const { m } = make(1000);
    m.submit("t", { payload: "hello" });
    m.claim("w1");
    expect(m.heartbeat("w2", "t")).toBe(false);
    expect(m.complete("w1", "t")).toBe(true);
    expect(m.status("t")).toBe("succeeded");
  });
});
