import { SagaError, SagaRunner, VirtualClock } from "../src/index.js";
import type { SagaDefinition } from "../src/index.js";

const ORDER: SagaDefinition = {
  name: "order",
  steps: [
    { name: "reserve", maxAttempts: 3, backoff: 10, compensate: "release" },
    { name: "charge", maxAttempts: 2, backoff: 20, compensate: "refund" },
    { name: "ship", compensate: "recall" },
  ],
};

function setup(): { runner: SagaRunner; clock: VirtualClock; id: string } {
  const clock = new VirtualClock();
  const runner = new SagaRunner(clock);
  runner.registerDefinition(ORDER);
  const id = runner.begin("order", { orderId: 7 }, "order-7");
  return { runner, clock, id };
}

function finish(runner: SagaRunner, id: string): void {
  for (let i = 0; i < 8 && runner.status(id).status === "running"; i++) runner.runNext(id);
}

describe("sagarec basic", () => {
  test("uses supplied virtual clock", () => {
    const { runner, clock } = setup();
    expect(runner.clock).toBe(clock);
  });

  test("begin creates running saga", () => {
    const { runner, id } = setup();
    expect(runner.status(id).status).toBe("running");
  });

  test("explicit saga id is returned", () => {
    const { id } = setup();
    expect(id).toBe("order-7");
  });

  test("single run advances one step", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    expect(runner.status(id).completedSteps).toEqual(["reserve"]);
  });

  test("happy path completes", () => {
    const { runner, id } = setup();
    finish(runner, id);
    expect(runner.status(id).status).toBe("completed");
  });

  test("happy path records all steps", () => {
    const { runner, id } = setup();
    finish(runner, id);
    expect(runner.status(id).completedSteps).toEqual(["reserve", "charge", "ship"]);
  });

  test("journal starts with SagaBegun", () => {
    const { runner, id } = setup();
    expect(runner.journalEntries(id)[0]?.type).toBe("SagaBegun");
  });

  test("status returns copied arrays", () => {
    const { runner, id } = setup();
    const view = runner.status(id);
    view.completedSteps.push("local");
    expect(runner.status(id).completedSteps).toEqual([]);
  });

  test("unknown definition throws SagaError", () => {
    expect(() => new SagaRunner().begin("missing")).toThrow(SagaError);
  });

  test("unknown saga throws SagaError", () => {
    expect(() => new SagaRunner().status("missing")).toThrow(SagaError);
  });

  test("negative tick throws SagaError", () => {
    const { runner } = setup();
    expect(() => runner.tick(-1)).toThrow(SagaError);
  });

  test("journal filter isolates saga", () => {
    const { runner, id } = setup();
    runner.begin("order", {}, "other");
    expect(runner.journalEntries(id).every((e) => e.sagaId === id)).toBe(true);
  });
});

describe("sagarec hell++", () => {
  test("definition registration is defensive", () => {
    const def: SagaDefinition = { name: "x", steps: [{ name: "a" }] };
    const runner = new SagaRunner();
    runner.registerDefinition(def);
    def.steps[0]!.name = "changed";
    const id = runner.begin("x", {}, "x1");
    runner.runNext(id);
    expect(runner.status(id).completedSteps).toEqual(["a"]);
  });

  test("duplicate definition is rejected", () => {
    const runner = new SagaRunner();
    runner.registerDefinition(ORDER);
    expect(() => runner.registerDefinition(ORDER)).toThrow(SagaError);
  });

  test("duplicate saga id is rejected without journal append", () => {
    const { runner } = setup();
    const before = runner.journalEntries().length;
    expect(() => runner.begin("order", {}, "order-7")).toThrow(SagaError);
    expect(runner.journalEntries()).toHaveLength(before);
  });

  test("first failure waits for retry", () => {
    const { runner, id } = setup();
    runner.failNext(id, "stock");
    runner.runNext(id);
    expect(runner.status(id)).toMatchObject({ status: "waiting-retry", attempt: 1, retryAt: 10 });
  });

  test("retry cannot run before due time", () => {
    const { runner, id } = setup();
    runner.failNext(id);
    runner.runNext(id);
    runner.tick(9);
    runner.runNext(id);
    expect(runner.status(id).completedSteps).toEqual([]);
  });

  test("retry becomes runnable at exact boundary", () => {
    const { runner, id } = setup();
    runner.failNext(id);
    runner.runNext(id);
    runner.tick(10);
    expect(runner.status(id).status).toBe("running");
    runner.runNext(id);
    expect(runner.status(id).completedSteps).toEqual(["reserve"]);
  });

  test("exponential retry uses failed attempt exponent", () => {
    const { runner, id } = setup();
    runner.failNext(id, "one");
    runner.runNext(id);
    runner.tick(10);
    runner.failNext(id, "two");
    runner.runNext(id);
    expect(runner.status(id).retryAt).toBe(30);
  });

  test("exhausted first step fails without compensation", () => {
    const { runner, id } = setup();
    for (const delay of [10, 20]) {
      runner.failNext(id);
      runner.runNext(id);
      runner.tick(delay);
    }
    runner.failNext(id, "final");
    runner.runNext(id);
    expect(runner.status(id)).toMatchObject({ status: "failed", compensatedSteps: [] });
  });

  test("later exhausted step enters compensation", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    runner.failNext(id);
    runner.runNext(id);
    runner.tick(20);
    runner.failNext(id, "declined");
    runner.runNext(id);
    expect(runner.status(id).status).toBe("compensating");
  });

  test("compensation is reverse completion order", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    runner.runNext(id);
    runner.failNext(id, "carrier");
    runner.runNext(id);
    runner.runNext(id);
    runner.runNext(id);
    expect(runner.status(id).compensatedSteps).toEqual(["refund", "release"]);
  });

  test("compensation ends failed with original error", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    runner.runNext(id);
    runner.failNext(id, "carrier");
    runner.runNext(id);
    runner.runNext(id);
    runner.runNext(id);
    expect(runner.status(id)).toMatchObject({ status: "failed", error: "carrier" });
  });

  test("attempt identity includes saga id", () => {
    const { runner, id } = setup();
    const other = runner.begin("order", {}, "order-8");
    runner.runNext(id);
    runner.runNext(other);
    expect(runner.status(other).completedSteps).toEqual(["reserve"]);
  });

  test("queued failures are consumed in order", () => {
    const { runner, id } = setup();
    runner.failNext(id, "first");
    runner.failNext(id, "second");
    runner.runNext(id);
    runner.tick(10);
    runner.runNext(id);
    expect(runner.status(id).error).toBe("second");
  });

  test("crash recovery preserves waiting retry", () => {
    const { runner, id } = setup();
    runner.failNext(id, "transient");
    runner.runNext(id);
    runner.crashAndRecover();
    expect(runner.status(id)).toMatchObject({ status: "waiting-retry", retryAt: 10, attempt: 1 });
  });

  test("crash after success does not duplicate successful event", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    runner.crashAndRecover();
    runner.runNext(id);
    const reserve = runner.journalEntries(id).filter((e) => e.type === "StepSucceeded" && e.step === "reserve");
    expect(reserve).toHaveLength(1);
  });

  test("crash during compensation resumes remaining reverse work", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    runner.runNext(id);
    runner.failNext(id, "stop");
    runner.runNext(id);
    runner.runNext(id);
    runner.crashAndRecover();
    runner.runNext(id);
    expect(runner.status(id).compensatedSteps).toEqual(["refund", "release"]);
  });

  test("journal sequence remains contiguous after recovery", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    runner.crashAndRecover();
    runner.runNext(id);
    expect(runner.journalEntries().map((e) => e.seq)).toEqual(
      runner.journalEntries().map((_, i) => i + 1),
    );
  });

  test("export is detached from internal journal", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    const state = runner.exportState();
    state.journal.length = 0;
    expect(runner.journalEntries().length).toBeGreaterThan(0);
  });

  test("import restores progress and clock", () => {
    const { runner, id } = setup();
    runner.runNext(id);
    runner.tick(17);
    const state = runner.exportState();
    const restored = new SagaRunner();
    restored.registerDefinition(ORDER);
    restored.importState(state);
    expect(restored.clock.now()).toBe(17);
    expect(restored.status(id).completedSteps).toEqual(["reserve"]);
  });

  test("import preserves next generated id", () => {
    const runner = new SagaRunner();
    runner.registerDefinition(ORDER);
    expect(runner.begin("order")).toBe("s1");
    const state = runner.exportState();
    const restored = new SagaRunner();
    restored.registerDefinition(ORDER);
    restored.importState(state);
    expect(restored.begin("order")).toBe("s2");
  });

  test("import requires registered definitions", () => {
    const { runner } = setup();
    const restored = new SagaRunner();
    expect(() => restored.importState(runner.exportState())).toThrow(SagaError);
  });

  test("terminal saga rejects additional execution", () => {
    const { runner, id } = setup();
    finish(runner, id);
    expect(() => runner.runNext(id)).toThrow(SagaError);
  });

  test("journal access returns deep copies", () => {
    const { runner } = setup();
    const rows = runner.journalEntries();
    const begun = rows[0];
    if (begun?.type === "SagaBegun") begun.input.orderId = 999;
    const again = runner.journalEntries()[0];
    expect(again?.type === "SagaBegun" ? again.input.orderId : undefined).toBe(7);
  });

  test("multiple sagas recover independently", () => {
    const { runner, id } = setup();
    const other = runner.begin("order", {}, "other");
    runner.runNext(id);
    runner.runNext(other);
    runner.runNext(other);
    runner.crashAndRecover();
    expect(runner.status(id).stepIndex).toBe(1);
    expect(runner.status(other).stepIndex).toBe(2);
  });
});
