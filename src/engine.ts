import type { RunSnapshot, StepDef, StepRuntime, WorkflowDef } from "./types.js";
import { Graph } from "./graph.js";
import { StateMachine } from "./state_machine.js";
import { RetryPolicy } from "./retry.js";
import { CancelScope } from "./cancel.js";
import { ResultCache } from "./cache.js";
import { Compensator } from "./compensate.js";
import { Invalidator } from "./invalidate.js";
import { Scheduler } from "./scheduler.js";
import { Executor, type Handler } from "./executor.js";

export class Engine {
  private sm = new StateMachine();
  private retry = new RetryPolicy();
  private cancelScope = new CancelScope();
  private cache = new ResultCache();
  private compensator = new Compensator();
  private invalidator = new Invalidator(this.cache);
  private runs = new Map<string, RunSnapshot>();
  private defs = new Map<string, WorkflowDef>();
  private graphs = new Map<string, Graph>();
  private handlers = new Map<string, Handler>();
  private schedulers = new Map<string, Scheduler>();
  private executors = new Executor(this.sm, this.cache, this.cancelScope);
  private seq = 1;
  private now = 0;

  register(def: WorkflowDef, handler: Handler): void {
    this.defs.set(def.id, def);
    this.graphs.set(def.id, new Graph(def.steps));
    this.schedulers.set(def.id, new Scheduler(this.graphs.get(def.id)!));
    this.handlers.set(def.id, handler);
  }

  start(workflowId: string): string {
    const def = this.defs.get(workflowId);
    if (!def) throw new Error("unknown workflow");
    const runId = `r${this.seq++}`;
    const steps: Record<string, StepRuntime> = {};
    for (const s of def.steps) {
      steps[s.id] = {
        id: s.id,
        state: "pending",
        generation: 1,
        attempt: 0,
      };
    }
    this.runs.set(runId, {
      runId,
      workflowId,
      status: "running",
      cancelRequested: false,
      steps,
      compensations: [],
    });
    return runId;
  }

  cancel(runId: string): void {
    const run = this.must(runId);
    run.cancelRequested = true;
    this.cancelScope.request(runId);
  }

  tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.now += 1;
      for (const run of this.runs.values()) this.tickRun(run);
    }
  }

  nowTick(): number {
    return this.now;
  }

  snapshot(runId: string): RunSnapshot {
    const run = this.must(runId);
    return structuredClone(run);
  }

  cached(runId: string, stepId: string, generation: number) {
    return this.cache.get(runId, stepId, generation);
  }

  private must(runId: string): RunSnapshot {
    const r = this.runs.get(runId);
    if (!r) throw new Error("unknown run");
    return r;
  }

  private tickRun(run: RunSnapshot): void {
    if (run.status === "rolled_back") return;

    // Cancel may arrive after a run already succeeded; still enter rollback.
    if (run.cancelRequested && run.status !== "rolling_back") {
      this.beginRollback(run);
    }

    if (run.status === "rolling_back") {
      this.progressRollback(run);
      return;
    }

    if (run.status === "succeeded" || run.status === "failed") return;

    const def = this.defs.get(run.workflowId)!;
    const graph = this.graphs.get(run.workflowId)!;
    const sched = this.schedulers.get(run.workflowId)!;
    const handler = this.handlers.get(run.workflowId)!;

    // retries become pending when due
    for (const st of Object.values(run.steps)) {
      if (st.state === "failed" && st.nextRetryAt !== undefined && st.nextRetryAt <= this.now) {
        this.invalidator.bumpAndInvalidate(run.runId, graph, run.steps, st.id);
        st.state = "pending";
        st.nextRetryAt = undefined;
        st.lastError = undefined;
      }
    }

    const ready = sched.runnable(run.steps, def.steps);
    for (const id of ready) {
      this.runStep(run, def.steps.find((s) => s.id === id)!, handler, graph);
    }

    if (run.cancelRequested) {
      this.beginRollback(run);
      return;
    }

    this.refreshStatus(run);
  }

  private runStep(
    run: RunSnapshot,
    stepDef: StepDef,
    handler: Handler,
    graph: Graph,
  ): void {
    const st = run.steps[stepDef.id];
    this.executors.start(run.runId, st);
    const inputs: Record<string, string> = {};
    for (const d of stepDef.deps) {
      const dep = run.steps[d];
      // Intentionally trust cache helper (bugs live in ResultCache / Graph.isReady).
      const cached = this.cache.get(run.runId, d, dep.generation);
      const val = cached?.value ?? dep.result?.value;
      if (val === undefined) {
        this.executors.finishFailure(run.runId, st, "missing input");
        return;
      }
      inputs[d] = val;
    }
    const out = handler({
      runId: run.runId,
      stepId: stepDef.id,
      inputs,
      tick: this.now,
      requestCancel: () => this.cancel(run.runId),
    });
    if (out.ok) {
      this.executors.finishSuccess(run.runId, st, out.value);
    } else {
      this.executors.finishFailure(run.runId, st, out.error);
      const when = this.retry.schedule(stepDef, st.attempt, this.now);
      st.attempt += 1;
      if (when !== undefined) st.nextRetryAt = when;
      else {
        void graph;
      }
    }
  }

  private beginRollback(run: RunSnapshot): void {
    run.status = "rolling_back";
    const def = this.defs.get(run.workflowId)!;
    const succeeded = Object.values(run.steps)
      .filter((s) => s.state === "succeeded")
      .map((s) => s.id);
    const order = this.compensator.order(def.steps, succeeded);
    for (const id of order) {
      const st = run.steps[id];
      if (st.state === "succeeded") {
        st.state = this.sm.transition(st.state, "rolling_back", true);
      }
    }
    // also cancel pending/running
    for (const st of Object.values(run.steps)) {
      if (st.state === "pending" || st.state === "running" || st.state === "failed") {
        try {
          st.state = this.sm.transition(st.state, "cancelled", true);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private progressRollback(run: RunSnapshot): void {
    const def = this.defs.get(run.workflowId)!;
    const rolling = Object.values(run.steps).filter((s) => s.state === "rolling_back");
    if (rolling.length === 0) {
      run.status = "rolled_back";
      this.cache.invalidateRun(run.runId);
      return;
    }
    // pick next in compensator order
    const order = this.compensator.order(
      def.steps,
      rolling.map((s) => s.id),
    );
    const id = order[0];
    const st = run.steps[id];
    const stepDef = def.steps.find((s) => s.id === id)!;
    run.compensations.push(this.compensator.label(stepDef));
    this.cache.invalidate(run.runId, id);
    st.result = undefined;
    st.state = this.sm.transition(st.state, "rolled_back", true);
  }

  private refreshStatus(run: RunSnapshot): void {
    const steps = Object.values(run.steps);
    if (steps.every((s) => s.state === "succeeded")) {
      run.status = "succeeded";
      return;
    }
    const def = this.defs.get(run.workflowId)!;
    const hardFail = steps.some((s) => {
      if (s.state !== "failed") return false;
      if (s.nextRetryAt !== undefined) return false;
      const stepDef = def.steps.find((d) => d.id === s.id)!;
      return this.retry.schedule(stepDef, s.attempt, this.now) === undefined;
    });
    if (hardFail) run.status = "failed";
  }
}
