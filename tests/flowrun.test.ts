import { Engine } from "../src/engine.js";
import type { WorkflowDef } from "../src/types.js";

const linear: WorkflowDef = {
  id: "linear",
  steps: [
    { id: "a", deps: [] },
    { id: "b", deps: ["a"] },
    { id: "c", deps: ["b"] },
  ],
};

const diamond: WorkflowDef = {
  id: "diamond",
  steps: [
    { id: "a", deps: [], compensate: "undo-a" },
    { id: "b", deps: ["a"], compensate: "undo-b" },
    { id: "c", deps: ["a"], compensate: "undo-c" },
    { id: "d", deps: ["b", "c"], compensate: "undo-d" },
  ],
};

const flaky: WorkflowDef = {
  id: "flaky",
  steps: [
    {
      id: "a",
      deps: [],
      retryDelays: [2, 2],
    },
    { id: "b", deps: ["a"] },
  ],
};

describe("flowrun", () => {
  test("linear happy path", () => {
    const eng = new Engine();
    eng.register(linear, ({ stepId, inputs }) => {
      if (stepId === "a") return { ok: true, value: "A" };
      if (stepId === "b") return { ok: true, value: `B:${inputs.a}` };
      return { ok: true, value: `C:${inputs.b}` };
    });
    const id = eng.start("linear");
    eng.tick(5);
    const snap = eng.snapshot(id);
    expect(snap.status).toBe("succeeded");
    expect(snap.steps.c.result?.value).toBe("C:B:A");
  });

  test("cancel prevents success after request and rolls back succeeded peers", () => {
    const eng = new Engine();
    let ranB = 0;
    eng.register(diamond, ({ stepId }) => {
      if (stepId === "a") return { ok: true, value: "A" };
      if (stepId === "b") {
        ranB++;
        return { ok: true, value: "B" };
      }
      if (stepId === "c") return { ok: true, value: "C" };
      return { ok: true, value: "D" };
    });
    const id = eng.start("diamond");
    eng.tick(1); // a
    eng.tick(1); // b,c maybe
    eng.cancel(id);
    eng.tick(10);
    const snap = eng.snapshot(id);
    expect(snap.status).toBe("rolled_back");
    expect(snap.steps.d.state === "succeeded").toBe(false);
    // compensation reverse topo: d before b/c before a (d may not have run)
    const comps = snap.compensations;
    if (comps.includes("undo-b") && comps.includes("undo-a")) {
      expect(comps.indexOf("undo-b")).toBeLessThan(comps.indexOf("undo-a"));
    }
    if (comps.includes("undo-c") && comps.includes("undo-a")) {
      expect(comps.indexOf("undo-c")).toBeLessThan(comps.indexOf("undo-a"));
    }
    expect(eng.cached(id, "a", 1)).toBeUndefined();
    void ranB;
  });

  test("retry bumps generation and forces downstream recompute", () => {
    const eng = new Engine();
    let aTries = 0;
    let bValues: string[] = [];
    eng.register(flaky, ({ stepId, inputs }) => {
      if (stepId === "a") {
        aTries++;
        if (aTries < 3) return { ok: false, error: "temp" };
        return { ok: true, value: `A${aTries}` };
      }
      bValues.push(inputs.a);
      return { ok: true, value: `B:${inputs.a}` };
    });
    const id = eng.start("flaky");
    eng.tick(20);
    const snap = eng.snapshot(id);
    expect(snap.status).toBe("succeeded");
    expect(snap.steps.a.generation).toBeGreaterThan(1);
    expect(bValues.at(-1)).toBe(snap.steps.a.result?.value);
    expect(snap.steps.b.result?.value).toBe(`B:${snap.steps.a.result?.value}`);
  });

  test("downstream recomputes after upstream retry from failure", () => {
    const eng = new Engine();
    let aTries = 0;
    let bSeen: string[] = [];
    eng.register(
      {
        id: "g2",
        steps: [
          { id: "a", deps: [], retryDelays: [1, 1] },
          { id: "b", deps: ["a"] },
          { id: "c", deps: ["b"] },
        ],
      },
      ({ stepId, inputs }) => {
        if (stepId === "a") {
          aTries++;
          if (aTries < 3) return { ok: false, error: "no" };
          return { ok: true, value: "NEW" };
        }
        if (stepId === "b") {
          bSeen.push(inputs.a);
          return { ok: true, value: `B:${inputs.a}` };
        }
        return { ok: true, value: `C:${inputs.b}` };
      },
    );
    const id = eng.start("g2");
    eng.tick(30);
    const snap = eng.snapshot(id);
    expect(snap.status).toBe("succeeded");
    expect(snap.steps.a.generation).toBe(snap.steps.a.result?.generation);
    expect(snap.steps.b.result?.value).toBe("B:NEW");
    expect(snap.steps.c.result?.value).toBe("C:B:NEW");
    expect(bSeen.every((v) => v === "NEW")).toBe(true);
    expect(eng.cached(id, "a", snap.steps.a.generation)?.value).toBe("NEW");
    expect(eng.cached(id, "a", 1)).toBeUndefined();
  });

  test("handler cancel mid-step must not commit success", () => {
    const eng = new Engine();
    eng.register(linear, ({ stepId, requestCancel }) => {
      if (stepId === "a") return { ok: true, value: "A" };
      if (stepId === "b") {
        requestCancel();
        return { ok: true, value: "B-should-not-commit" };
      }
      return { ok: true, value: "C" };
    });
    const id = eng.start("linear");
    eng.tick(10);
    const snap = eng.snapshot(id);
    expect(snap.steps.b.state).not.toBe("succeeded");
    expect(snap.steps.b.result).toBeUndefined();
    expect(snap.steps.c.state).not.toBe("succeeded");
    expect(snap.status).toBe("rolled_back");
    // If b wrongly committed success, compensation would mention it.
    expect(snap.compensations.some((c) => c.includes("b"))).toBe(false);
    expect(eng.cached(id, "b", 1)).toBeUndefined();
    expect(eng.cached(id, "a", 1)).toBeUndefined();
  });

  test("diamond rollback order is reverse dependency order", () => {
    const eng = new Engine();
    eng.register(diamond, ({ stepId }) => ({ ok: true, value: stepId }));
    const id = eng.start("diamond");
    eng.tick(10);
    expect(eng.snapshot(id).status).toBe("succeeded");
    eng.cancel(id);
    eng.tick(20);
    const comps = eng.snapshot(id).compensations;
    expect(comps[0]).toBe("undo-d");
    expect(comps.indexOf("undo-a")).toBe(comps.length - 1);
    expect(comps.indexOf("undo-b")).toBeLessThan(comps.indexOf("undo-a"));
    expect(comps.indexOf("undo-c")).toBeLessThan(comps.indexOf("undo-a"));
  });

  test("two isolated runs do not share cache", () => {
    const eng = new Engine();
    eng.register(linear, ({ stepId, runId }) => ({
      ok: true,
      value: `${stepId}:${runId}`,
    }));
    const r1 = eng.start("linear");
    const r2 = eng.start("linear");
    eng.tick(10);
    expect(eng.snapshot(r1).steps.a.result?.value).toBe(`a:${r1}`);
    expect(eng.snapshot(r2).steps.a.result?.value).toBe(`a:${r2}`);
    expect(eng.cached(r1, "a", 1)?.value).toBe(`a:${r1}`);
    expect(eng.cached(r2, "a", 1)?.value).toBe(`a:${r2}`);
  });
});
