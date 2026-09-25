import { VirtualClock, SagaEngine } from "../src/index.js";
import type { SagaDef, StepHandler } from "../src/index.js";

const ORDER_DEF: SagaDef = {
  name: "order",
  steps: [
    { name: "reserve", timeout: 100, compensate: "release" },
    { name: "pay", timeout: 100, compensate: "refund" },
    { name: "confirm", timeout: 100, compensate: "cancelConfirm" },
  ],
};

type HandlerMap = Record<string, StepHandler>;

function setup(
  forward: HandlerMap,
  compensate: HandlerMap = {
    release: () => ({ ok: true }),
    refund: () => ({ ok: true }),
    cancelConfirm: () => ({ ok: true }),
  },
) {
  const clock = new VirtualClock();
  const eng = new SagaEngine(clock);
  eng.register(ORDER_DEF, forward);
  eng.registerCompensate("order", compensate);
  return { clock, eng };
}

function runToCompletion(
  eng: SagaEngine,
  clock: VirtualClock,
  sagaId: string,
  maxTicks = 20,
): void {
  for (let i = 0; i < maxTicks; i++) {
    eng.tick();
    if (["completed", "failed", "aborted"].includes(eng.status(sagaId).status)) {
      return;
    }
    clock.advance(1);
  }
}

describe("sagaeng saga orchestrator", () => {
  test("happy path completes three steps in order", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s1", { orderId: 1 });
    runToCompletion(eng, clock, "s1");
    expect(eng.status("s1").status).toBe("completed");
    expect(eng.effects("s1")).toEqual(["do:reserve", "do:pay", "do:confirm"]);
  });

  test("step failure mid saga compensates completed steps in reverse", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: false, error: "declined" }),
    });
    eng.start("order", "s2");
    runToCompletion(eng, clock, "s2");
    expect(eng.status("s2").status).toBe("failed");
    expect(eng.status("s2").compensations).toEqual(["refund", "release"]);
    expect(eng.effects("s2")).toEqual([
      "do:reserve",
      "do:pay",
      "undo:refund",
      "undo:release",
    ]);
  });

  test("timeout triggers compensation for completed steps", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: false, error: "__pending__" }),
    });
    eng.start("order", "s3");
    eng.tick();
    eng.tick();
    eng.tick();
    clock.advance(100);
    eng.tick();
    runToCompletion(eng, clock, "s3");
    expect(eng.status("s3").status).toBe("failed");
    expect(eng.effects("s3")).toEqual([
      "do:reserve",
      "do:pay",
      "undo:refund",
      "undo:release",
    ]);
  });

  test("late success after timeout is rejected", () => {
    let payCalls = 0;
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => {
        payCalls += 1;
        if (payCalls === 1) return { ok: false, error: "__pending__" };
        return { ok: true };
      },
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s4");
    eng.tick();
    eng.tick();
    clock.advance(100);
    eng.tick();
    eng.tick();
    expect(eng.effects("s4")).not.toContain("do:pay");
    expect(eng.status("s4").status).toBe("failed");
  });

  test("cancel mid saga compensates completed steps in reverse", () => {
    const { eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: false, error: "__pending__" }),
    });
    eng.start("order", "s5");
    eng.tick();
    eng.tick();
    eng.tick();
    eng.cancel("s5");
    eng.tick();
    expect(eng.status("s5").status).toBe("aborted");
    expect(eng.status("s5").compensations).toEqual(["refund", "release"]);
    expect(eng.effects("s5")).toEqual([
      "do:reserve",
      "do:pay",
      "undo:refund",
      "undo:release",
    ]);
  });

  test("crash after step1 recover does not duplicate do effects", () => {
    const { eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: false, error: "__pending__" }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s6");
    eng.start("order", "s6b");
    eng.tick();
    eng.tick();
    expect(eng.effects("s6")).toEqual(["do:reserve"]);
    expect(eng.effects("s6b")).toEqual(["do:reserve"]);
    eng.crash();
    eng.recover();
    eng.tick();
    eng.tick();
    expect(eng.effects("s6").filter((e) => e === "do:reserve")).toHaveLength(1);
    expect(eng.effects("s6b").filter((e) => e === "do:reserve")).toHaveLength(1);
  });

  test("crash during compensate recover does not duplicate undo effects", () => {
    let releaseAttempts = 0;
    const { eng } = setup(
      {
        reserve: () => ({ ok: true }),
        pay: () => ({ ok: false, error: "fail" }),
        confirm: () => ({ ok: true }),
      },
      {
        release: () => {
          releaseAttempts += 1;
          if (releaseAttempts < 2) return { ok: false, error: "__pending__" };
          return { ok: true };
        },
        refund: () => ({ ok: true }),
        cancelConfirm: () => ({ ok: true }),
      },
    );
    eng.start("order", "s7");
    eng.tick();
    eng.tick();
    expect(eng.status("s7").status).toBe("compensating");
    eng.crash();
    eng.recover();
    eng.tick();
    eng.tick();
    expect(eng.effects("s7").filter((e) => e === "undo:release")).toHaveLength(1);
  });

  test("double tick on completed saga is idempotent for effects", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s8");
    runToCompletion(eng, clock, "s8");
    const before = eng.effects("s8");
    eng.tick();
    eng.tick();
    expect(eng.effects("s8")).toEqual(before);
  });

  test("two sagas are isolated on the same engine", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "a");
    eng.start("order", "b");
    runToCompletion(eng, clock, "a");
    runToCompletion(eng, clock, "b");
    expect(eng.status("a").status).toBe("completed");
    expect(eng.status("b").status).toBe("completed");
    expect(eng.effects("a")).toEqual(["do:reserve", "do:pay", "do:confirm"]);
    expect(eng.effects("b")).toEqual(["do:reserve", "do:pay", "do:confirm"]);
  });

  test("exact timeout boundary fires at deadline equality", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: false, error: "__pending__" }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s9");
    eng.tick();
    eng.tick();
    clock.advance(99);
    eng.tick();
    expect(eng.status("s9").status).toBe("running");
    clock.advance(1);
    eng.tick();
    expect(eng.status("s9").status).toBe("failed");
    expect(eng.effects("s9")).toEqual(["do:reserve", "undo:release"]);
  });

  test("compensate labels follow def compensate fields in reverse completion order", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: false, error: "nope" }),
    });
    eng.start("order", "s10");
    runToCompletion(eng, clock, "s10");
    expect(eng.status("s10").compensations).toEqual(["refund", "release"]);
    expect(eng.effects("s10")).toEqual([
      "do:reserve",
      "do:pay",
      "undo:refund",
      "undo:release",
    ]);
  });

  test("first step failure aborts without compensation", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: false, error: "no stock" }),
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s11");
    runToCompletion(eng, clock, "s11");
    expect(eng.status("s11").status).toBe("failed");
    expect(eng.status("s11").completedSteps).toEqual([]);
    expect(eng.effects("s11")).toEqual([]);
  });

  test("missing forward handler surfaces failed status", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s12");
    runToCompletion(eng, clock, "s12");
    expect(eng.status("s12").status).toBe("failed");
    expect(eng.status("s12").error).toMatch(/missing handler/);
  });

  test("__pending__ handler retries on next tick then succeeds", () => {
    let attempts = 0;
    const { clock, eng } = setup({
      reserve: () => {
        attempts += 1;
        if (attempts < 2) return { ok: false, error: "__pending__" };
        return { ok: true };
      },
      pay: () => ({ ok: true }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s13");
    eng.tick();
    expect(eng.status("s13").completedSteps).toEqual([]);
    eng.tick();
    runToCompletion(eng, clock, "s13");
    expect(eng.status("s13").status).toBe("completed");
    expect(eng.effects("s13")[0]).toBe("do:reserve");
  });

  test("cancel clears pending timeout so step cannot complete afterward", () => {
    const { clock, eng } = setup({
      reserve: () => ({ ok: true }),
      pay: () => ({ ok: false, error: "__pending__" }),
      confirm: () => ({ ok: true }),
    });
    eng.start("order", "s14");
    eng.tick();
    eng.tick();
    eng.cancel("s14");
    clock.advance(200);
    eng.tick();
    expect(eng.effects("s14")).not.toContain("do:pay");
    expect(eng.status("s14").status).toBe("aborted");
  });

  test("status exposes compensating while undo handlers pending", () => {
    const { eng } = setup(
      {
        reserve: () => ({ ok: true }),
        pay: () => ({ ok: false, error: "fail" }),
        confirm: () => ({ ok: true }),
      },
      {
        release: () => ({ ok: false, error: "__pending__" }),
        refund: () => ({ ok: true }),
        cancelConfirm: () => ({ ok: true }),
      },
    );
    eng.start("order", "s15");
    eng.tick();
    eng.tick();
    eng.tick();
    expect(eng.status("s15").status).toBe("compensating");
  });

  test("input is forwarded to step handlers", () => {
    const seen: Record<string, unknown>[] = [];
    const { clock, eng } = setup({
      reserve: (ctx) => {
        seen.push({ ...ctx.input });
        return { ok: true };
      },
      pay: (ctx) => {
        seen.push({ ...ctx.input });
        return { ok: true };
      },
      confirm: (ctx) => {
        seen.push({ ...ctx.input });
        return { ok: true };
      },
    });
    eng.start("order", "s16", { orderId: 42, sku: "ABC" });
    runToCompletion(eng, clock, "s16");
    expect(seen).toHaveLength(3);
    expect(seen.every((x) => x.orderId === 42 && x.sku === "ABC")).toBe(true);
  });
});
