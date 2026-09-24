import { expectedBackoffMs, makeOrch } from "./helpers.js";

describe("retry and cancel", () => {
  test("retries with deterministic backoff", async () => {
    const { orch, clock } = makeOrch(1);
    let attempts = 0;
    const runId = orch.start({
      tasks: [
        {
          id: "flaky",
          tenantId: "t",
          deps: [],
          maxAttempts: 3,
          baseBackoffMs: 100,
          maxBackoffMs: 10_000,
          run: async () => {
            attempts++;
            if (attempts < 3) throw new Error("boom");
          },
        },
      ],
    });
    await orch.drain();
    expect(orch.taskStatus(runId, "flaky")).toBe("pending");
    // after first fail, attempt=1 consumed; next backoff uses attempt=1
    const b1 = expectedBackoffMs(1, 100, 10_000, runId, "flaky");
    clock.advance(b1 - 1);
    await orch.drain();
    expect(attempts).toBe(1);
    clock.advance(1);
    await orch.drain();
    expect(attempts).toBe(2);
    const b2 = expectedBackoffMs(2, 100, 10_000, runId, "flaky");
    clock.advance(b2);
    await orch.drain();
    expect(attempts).toBe(3);
    expect(orch.taskStatus(runId, "flaky")).toBe("succeeded");
    expect(orch.status(runId)).toBe("succeeded");
  });

  test("cancel skips pending and marks run cancelled", async () => {
    const { orch } = makeOrch(1);
    let startedB = false;
    const runId = orch.start({
      tasks: [
        {
          id: "a",
          tenantId: "t",
          deps: [],
          run: async (ctx) => {
            // stay running until cancelled check
            for (let i = 0; i < 5; i++) {
              if (ctx.isCancelled()) return;
              await Promise.resolve();
            }
          },
        },
        {
          id: "b",
          tenantId: "t",
          deps: ["a"],
          run: async () => {
            startedB = true;
          },
        },
      ],
    });
    // start draining in background-ish: first drain starts a
    const p = orch.drain();
    orch.cancel(runId);
    await p;
    await orch.drain();
    expect(startedB).toBe(false);
    expect(orch.status(runId)).toBe("cancelled");
    expect(["cancelled", "succeeded", "running"]).toContain(
      orch.taskStatus(runId, "a"),
    );
    expect(["cancelled", "skipped", "pending"]).toContain(
      orch.taskStatus(runId, "b"),
    );
  });
});
