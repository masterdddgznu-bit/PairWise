import { makeOrch } from "./helpers.js";
import { EffectLog } from "../src/effect_log.js";

describe("scheduler basics", () => {
  test("respects dependencies order", async () => {
    const { orch } = makeOrch(2);
    const order: string[] = [];
    const runId = orch.start({
      tasks: [
        {
          id: "a",
          tenantId: "t1",
          deps: [],
          run: async () => {
            order.push("a");
          },
        },
        {
          id: "b",
          tenantId: "t1",
          deps: ["a"],
          run: async () => {
            order.push("b");
          },
        },
        {
          id: "c",
          tenantId: "t1",
          deps: ["b"],
          run: async () => {
            order.push("c");
          },
        },
      ],
    });
    await orch.drain();
    expect(order).toEqual(["a", "b", "c"]);
    expect(orch.status(runId)).toBe("succeeded");
  });

  test("maxWorkers caps concurrency", async () => {
    const { orch } = makeOrch(2);
    let inflight = 0;
    let maxInflight = 0;
    const mk = (id: string) => ({
      id,
      tenantId: "t",
      deps: [] as string[],
      run: async () => {
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        await Promise.resolve();
        inflight--;
      },
    });
    orch.start({ tasks: [mk("1"), mk("2"), mk("3"), mk("4")] });
    await orch.drain();
    expect(maxInflight).toBeLessThanOrEqual(2);
    expect(maxInflight).toBeGreaterThanOrEqual(2);
  });

  test("fair share across tenants", async () => {
    const { orch } = makeOrch(1);
    const order: string[] = [];
    const mk = (id: string, tenantId: string) => ({
      id,
      tenantId,
      deps: [] as string[],
      run: async () => {
        order.push(tenantId);
      },
    });
    orch.start({
      tasks: [
        mk("a1", "a"),
        mk("a2", "a"),
        mk("b1", "b"),
        mk("b2", "b"),
        mk("c1", "c"),
        mk("c2", "c"),
      ],
    });
    await orch.drain();
    // With 1 worker, fair round-robin should interleave tenants for first 6.
    expect(order.slice(0, 3).sort()).toEqual(["a", "b", "c"]);
  });
});
