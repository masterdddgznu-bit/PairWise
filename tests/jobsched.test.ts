import { Scheduler, VirtualClock } from "../src/index.js";

function setup(opts?: {
  leaseTtl?: number;
  retryBackoff?: number[];
  maxAttempts?: number;
}) {
  const clock = new VirtualClock();
  const sched = new Scheduler({ clock, ...opts });
  return { clock, sched };
}

describe("jobsched", () => {
  test("single job claim complete happy path", () => {
    const { sched } = setup();
    sched.submit({ id: "j1", work: "alpha" });
    const c = sched.claim("w1");
    expect(c).toEqual({ jobId: "j1", leaseToken: 1, work: "alpha" });
    sched.complete("w1", "j1", c!.leaseToken);
    expect(sched.status("j1").status).toBe("succeeded");
    expect(sched.effects()).toEqual(["done:alpha"]);
  });

  test("linear deps A→B→C complete in order", () => {
    const { sched } = setup();
    sched.submit({ id: "A", work: "a" });
    sched.submit({ id: "B", deps: ["A"], work: "b" });
    sched.submit({ id: "C", deps: ["B"], work: "c" });

    const a = sched.claim("w1");
    expect(a?.jobId).toBe("A");
    expect(sched.claim("w2")).toBeNull();
    sched.complete("w1", "A", a!.leaseToken);

    const b = sched.claim("w1");
    expect(b?.jobId).toBe("B");
    expect(sched.claim("w2")).toBeNull();
    sched.complete("w1", "B", b!.leaseToken);

    const c = sched.claim("w1");
    expect(c?.jobId).toBe("C");
    sched.complete("w1", "C", c!.leaseToken);

    expect(sched.effects()).toEqual(["done:a", "done:b", "done:c"]);
  });

  test("parallel jobs without deps both claimable", () => {
    const { sched } = setup();
    sched.submit({ id: "p1", work: "x" });
    sched.submit({ id: "p2", work: "y" });
    const c1 = sched.claim("w1");
    const c2 = sched.claim("w2");
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(new Set([c1!.jobId, c2!.jobId])).toEqual(new Set(["p1", "p2"]));
    sched.complete("w1", c1!.jobId, c1!.leaseToken);
    sched.complete("w2", c2!.jobId, c2!.leaseToken);
    expect(sched.effects().sort()).toEqual(["done:x", "done:y"].sort());
  });

  test("cycle submit rejected", () => {
    const { sched } = setup();
    expect(() =>
      sched.submit({ id: "loop", deps: ["loop"], work: "x" }),
    ).toThrow(/cycle/);
    sched.submit({ id: "A", work: "a" });
    sched.submit({ id: "B", deps: ["A"], work: "b" });
    // Closing an existing chain back onto itself is a cycle.
    expect(() =>
      sched.submit({ id: "C", deps: ["B", "C"], work: "c" }),
    ).toThrow(/cycle/);
  });

  test("missing dep submit error", () => {
    const { sched } = setup();
    expect(() =>
      sched.submit({ id: "B", deps: ["nope"], work: "b" }),
    ).toThrow(/missing/);
  });

  test("lease expiry allows another worker to claim", () => {
    const { clock, sched } = setup({ leaseTtl: 10 });
    sched.submit({ id: "j", work: "w" });
    const c1 = sched.claim("w1");
    expect(c1).not.toBeNull();
    clock.advance(10);
    sched.tick();
    expect(sched.status("j").status).toBe("pending");
    const c2 = sched.claim("w2");
    expect(c2).not.toBeNull();
    expect(c2!.leaseToken).toBeGreaterThan(c1!.leaseToken);
  });

  test("exact lease boundary expires at equality", () => {
    const { clock, sched } = setup({ leaseTtl: 10 });
    sched.submit({ id: "j", work: "w" });
    sched.claim("w1");
    clock.advance(10);
    sched.tick();
    expect(sched.status("j").status).toBe("pending");
  });

  test("stale complete after steal rejected; one effect", () => {
    const { clock, sched } = setup({ leaseTtl: 10 });
    sched.submit({ id: "j", work: "payload" });
    const c1 = sched.claim("w1")!;
    clock.advance(10);
    sched.tick();
    const c2 = sched.claim("w2")!;
    expect(c2.leaseToken).not.toBe(c1.leaseToken);
    sched.complete("w1", "j", c1.leaseToken);
    expect(sched.effects()).toEqual([]);
    sched.complete("w2", "j", c2.leaseToken);
    expect(sched.effects()).toEqual(["done:payload"]);
    expect(sched.status("j").status).toBe("succeeded");
  });

  test("heartbeat prevents lease expiry", () => {
    const { clock, sched } = setup({ leaseTtl: 10 });
    sched.submit({ id: "j", work: "w" });
    const c = sched.claim("w1")!;
    clock.advance(9);
    sched.heartbeat("w1", "j", c.leaseToken);
    clock.advance(9);
    sched.tick();
    expect(sched.status("j").status).toBe("running");
    expect(sched.status("j").owner).toBe("w1");
  });

  test("fail then retry after backoff", () => {
    const { clock, sched } = setup({
      leaseTtl: 10,
      retryBackoff: [5, 10],
      maxAttempts: 3,
    });
    sched.submit({ id: "j", work: "w" });
    const c1 = sched.claim("w1")!;
    sched.fail("w1", "j", c1.leaseToken, "boom");
    expect(sched.status("j")).toMatchObject({
      status: "retry_wait",
      attempts: 1,
    });
    sched.tick();
    expect(sched.status("j").status).toBe("retry_wait");
    expect(sched.claim("w2")).toBeNull();
    clock.advance(5);
    sched.tick();
    expect(sched.status("j").status).toBe("pending");
    const c2 = sched.claim("w2");
    expect(c2).not.toBeNull();
  });

  test("maxAttempts exhausted marks failed", () => {
    const { clock, sched } = setup({
      retryBackoff: [0],
      maxAttempts: 2,
    });
    sched.submit({ id: "j", work: "w" });
    for (let i = 0; i < 2; i++) {
      const c = sched.claim("w1")!;
      sched.fail("w1", "j", c.leaseToken, "err");
      if (sched.status("j").status === "retry_wait") {
        clock.advance(0);
        sched.tick();
      }
    }
    expect(sched.status("j").status).toBe("failed");
    expect(sched.status("j").attempts).toBe(2);
    expect(sched.claim("w2")).toBeNull();
  });

  test("crash after complete recover no duplicate effect", () => {
    const { sched } = setup();
    sched.submit({ id: "j", work: "z" });
    const c = sched.claim("w1")!;
    sched.complete("w1", "j", c.leaseToken);
    expect(sched.effects()).toEqual(["done:z"]);
    sched.crash();
    sched.recover();
    expect(sched.status("j").status).toBe("succeeded");
    expect(sched.effects()).toEqual(["done:z"]);
  });

  test("crash mid-running recover allows reclaim", () => {
    const { sched } = setup();
    sched.submit({ id: "j", work: "z" });
    sched.claim("w1");
    expect(sched.status("j").status).toBe("running");
    sched.crash();
    sched.recover();
    const c2 = sched.claim("w2");
    expect(c2).not.toBeNull();
    expect(c2!.jobId).toBe("j");
    sched.complete("w2", "j", c2!.leaseToken);
    expect(sched.effects()).toEqual(["done:z"]);
  });

  test("effects order respects deps", () => {
    const { sched } = setup();
    sched.submit({ id: "A", work: "a" });
    sched.submit({ id: "B", deps: ["A"], work: "b" });
    sched.submit({ id: "C", deps: ["A"], work: "c" });
    const a = sched.claim("w1")!;
    sched.complete("w1", "A", a.leaseToken);
    const b = sched.claim("w1")!;
    const c = sched.claim("w2")!;
    expect(new Set([b.jobId, c.jobId])).toEqual(new Set(["B", "C"]));
    sched.complete("w1", b.jobId, b.leaseToken);
    sched.complete("w2", c.jobId, c.leaseToken);
    expect(sched.effects()[0]).toBe("done:a");
    expect(new Set(sched.effects().slice(1))).toEqual(
      new Set(["done:b", "done:c"]),
    );
  });

  test("two workers cannot double-complete same job without steal", () => {
    const { sched } = setup();
    sched.submit({ id: "j", work: "only" });
    const c1 = sched.claim("w1")!;
    expect(sched.claim("w2")).toBeNull();
    sched.complete("w1", "j", c1.leaseToken);
    sched.complete("w2", "j", c1.leaseToken);
    expect(sched.effects()).toEqual(["done:only"]);
  });

  test("claim does not return job whose deps are unmet", () => {
    const { sched } = setup();
    sched.submit({ id: "A", work: "a" });
    sched.submit({ id: "B", deps: ["A"], work: "b" });
    const first = sched.claim("w1");
    expect(first?.jobId).toBe("A");
    // B must not be claimable while A still running
    expect(sched.claim("w2")).toBeNull();
  });

  test("failed dependency blocks dependent claim", () => {
    const { clock, sched } = setup({
      retryBackoff: [0],
      maxAttempts: 1,
    });
    sched.submit({ id: "A", work: "a" });
    sched.submit({ id: "B", deps: ["A"], work: "b" });
    const c = sched.claim("w1")!;
    sched.fail("w1", "A", c.leaseToken, "nope");
    expect(sched.status("A").status).toBe("failed");
    clock.advance(0);
    sched.tick();
    expect(sched.claim("w2")).toBeNull();
  });
});
