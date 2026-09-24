import { EffectLog } from "../src/effect_log.js";
import { makeOrch } from "./helpers.js";

describe("checkpoint recovery", () => {
  test("does not re-execute succeeded tasks after crash", async () => {
    const log = new EffectLog();
    const { orch } = makeOrch(2);
    const runId = orch.start({
      tasks: [
        {
          id: "a",
          tenantId: "t",
          deps: [],
          run: async () => {
            log.record("a");
          },
        },
        {
          id: "b",
          tenantId: "t",
          deps: ["a"],
          run: async () => {
            log.record("b");
          },
        },
        {
          id: "c",
          tenantId: "t",
          deps: ["b"],
          run: async () => {
            log.record("c");
          },
        },
      ],
    });

    // Partially run: only allow finishing `a` then checkpoint/crash before b/c.
    // Implementation detail under test: after first drain, if maxWorkers scheduling
    // runs ready tasks, `a` should complete. Then we crash before further drains.
    await orch.drain();
    // If implementation runs the whole DAG in one drain, still must be idempotent.
    orch.checkpoint();
    orch.crash();
    orch.recover();
    await orch.drain();

    expect(log.count("a")).toBe(1);
    expect(log.count("b")).toBe(1);
    expect(log.count("c")).toBe(1);
    expect(orch.status(runId)).toBe("succeeded");
  });
});
