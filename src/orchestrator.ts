import type { VirtualClock } from "./clock.js";
import type { SagaDef, SagaInstance, SagaStatusView, StepHandler } from "./types.js";
import { Journal } from "./journal.js";
import { IdempotencyStore } from "./idempotency.js";
import { TimeoutWheel } from "./timeout_wheel.js";
import { Registry } from "./registry.js";
import { StepExecutor } from "./step_executor.js";
import { Compensator } from "./compensator.js";

/** Saga orchestrator — coordinates steps, timeouts, compensation, recovery. */
export class SagaEngine {
  private journal = new Journal();
  private idempotency = new IdempotencyStore();
  private timeouts = new TimeoutWheel();
  private registry = new Registry();
  private executor: StepExecutor;
  private compensator: Compensator;
  private instances = new Map<string, SagaInstance>();

  constructor(private readonly clock: VirtualClock) {
    this.executor = new StepExecutor(this.journal, this.idempotency);
    this.compensator = new Compensator(this.journal, this.idempotency);
  }

  register(def: SagaDef, handlers: Record<string, StepHandler>): void {
    this.registry.register(def, handlers);
  }

  registerCompensate(defName: string, handlers: Record<string, StepHandler>): void {
    this.registry.registerCompensate(defName, handlers);
  }

  start(defName: string, sagaId: string, input: Record<string, unknown> = {}): void {
    const def = this.registry.getDef(defName);
    if (!def) {
      throw new Error(`unknown saga def: ${defName}`);
    }
    if (this.instances.has(sagaId)) {
      throw new Error(`saga already exists: ${sagaId}`);
    }

    const inst: SagaInstance = {
      sagaId,
      defName,
      input: { ...input },
      status: "running",
      stepIndex: 0,
      completedSteps: [],
      compensations: [],
      compensateQueue: [],
      compensateIndex: 0,
      effects: [],
    };
    this.instances.set(sagaId, inst);
    this.journal.append({
      type: "SagaStarted",
      sagaId,
      defName,
      input: inst.input,
      at: this.clock.now(),
    });
  }

  tick(): void {
    const now = this.clock.now();

    for (const entry of this.timeouts.fireDue(now)) {
      const inst = this.instances.get(entry.sagaId);
      if (!inst || inst.status !== "running") continue;
      if (inst.currentStep === entry.stepName) {
        this.executor.markTimedOut(inst, entry.stepName, now);
        this.beginCompensate(inst, now, "timeout");
      }
    }

    for (const inst of this.instances.values()) {
      if (inst.status === "running") {
        this.driveForward(inst, now);
      } else if (inst.status === "compensating") {
        this.driveCompensate(inst, now);
      }
    }
  }

  cancel(sagaId: string): void {
    const inst = this.instances.get(sagaId);
    if (!inst) throw new Error(`unknown saga: ${sagaId}`);
    if (inst.status !== "running") return;

    this.timeouts.cancel(sagaId);
    inst.currentStep = undefined;
    inst.stepDeadline = undefined;
    inst.status = "compensating";
    inst.error = "cancelled";
    this.journal.append({
      type: "CompensatingStarted",
      sagaId,
      at: this.clock.now(),
    });
    if (inst.completedSteps.length === 0) {
      inst.status = "aborted";
      this.journal.append({ type: "SagaAborted", sagaId, at: this.clock.now() });
      return;
    }
    this.driveCompensate(inst, this.clock.now());
  }

  status(sagaId: string): SagaStatusView {
    const inst = this.instances.get(sagaId);
    if (!inst) throw new Error(`unknown saga: ${sagaId}`);
    return {
      status: inst.status,
      completedSteps: [...inst.completedSteps],
      compensations: [...inst.compensations],
      error: inst.error,
    };
  }

  effects(sagaId: string): string[] {
    const inst = this.instances.get(sagaId);
    if (!inst) throw new Error(`unknown saga: ${sagaId}`);
    return [...inst.effects];
  }

  crash(): void {
    this.instances.clear();
    this.timeouts.rebuild([]);
  }

  recover(): void {
    this.instances = this.journal.rebuildInstances();
    this.timeouts.rebuild([]);
    for (const ev of this.journal.all()) {
      if (ev.type !== "Effect") continue;
      if (ev.effect.startsWith("do:")) {
        this.idempotency.mark(ev.sagaId, ev.effect.slice(3), "do");
      } else if (ev.effect.startsWith("undo:")) {
        this.idempotency.mark(ev.sagaId, ev.effect.slice(5), "undo");
      }
    }
    for (const inst of this.instances.values()) {
      if (inst.status === "running" && inst.currentStep && inst.stepDeadline !== undefined) {
        this.timeouts.register(inst.sagaId, inst.currentStep, inst.stepDeadline);
      }
    }
  }

  private beginCompensate(inst: SagaInstance, at: number, error: string): void {
    inst.status = "compensating";
    inst.error = error;
    inst.compensateQueue = [];
    inst.compensateIndex = 0;
    this.journal.append({ type: "CompensatingStarted", sagaId: inst.sagaId, at });
  }

  private driveForward(inst: SagaInstance, now: number): void {
    const def = this.registry.getDef(inst.defName);
    const handlers = this.registry.getHandlers(inst.defName);
    if (!def || !handlers) return;

    if (inst.stepIndex >= def.steps.length) {
      inst.status = "completed";
      this.journal.append({ type: "SagaCompleted", sagaId: inst.sagaId, at: now });
      return;
    }

    const step = def.steps[inst.stepIndex]!;
    if (!inst.currentStep) {
      inst.currentStep = step.name;
      inst.stepDeadline = now + step.timeout;
      inst.timedOut = false;
      this.journal.append({
        type: "StepStarted",
        sagaId: inst.sagaId,
        stepName: step.name,
        deadline: inst.stepDeadline,
        at: now,
      });
      this.timeouts.register(inst.sagaId, step.name, inst.stepDeadline);
    }

    if (inst.stepDeadline !== undefined && now >= inst.stepDeadline) {
      this.executor.markTimedOut(inst, step.name, now);
      this.beginCompensate(inst, now, "timeout");
      return;
    }

    const handler = handlers[step.name];
    if (!handler) {
      inst.error = `missing handler: ${step.name}`;
      if (inst.completedSteps.length === 0) {
        inst.status = "failed";
        this.journal.append({
          type: "SagaFailed",
          sagaId: inst.sagaId,
          error: inst.error,
          at: now,
        });
      } else {
        this.beginCompensate(inst, now, inst.error);
      }
      return;
    }

    const result = this.executor.runForward(inst, step.name, handler, now);
    if (result.kind === "pending") return;
    if (result.kind === "failed") {
      this.journal.append({
        type: "StepFailed",
        sagaId: inst.sagaId,
        stepName: step.name,
        error: result.error,
        at: now,
      });
      if (inst.completedSteps.length === 0) {
        inst.status = "failed";
        this.journal.append({
          type: "SagaFailed",
          sagaId: inst.sagaId,
          error: result.error,
          at: now,
        });
      } else {
        this.beginCompensate(inst, now, result.error);
      }
      return;
    }
    if (result.kind === "timedOut") {
      this.beginCompensate(inst, now, "timeout");
      return;
    }

    if (inst.stepIndex >= def.steps.length) {
      inst.status = "completed";
      this.journal.append({ type: "SagaCompleted", sagaId: inst.sagaId, at: now });
    }
  }

  private driveCompensate(inst: SagaInstance, now: number): void {
    const def = this.registry.getDef(inst.defName);
    const handlers = this.registry.getCompensateHandlers(inst.defName);
    if (!def || !handlers) return;

    while (inst.status === "compensating") {
      const outcome = this.compensator.runOne(inst, def, handlers, now);
      if (outcome === "pending") return;
      if (outcome === "advanced") continue;
      if (inst.compensateIndex >= inst.compensateQueue.length) {
        inst.status = inst.error === "cancelled" ? "aborted" : "failed";
        if (inst.status === "aborted") {
          this.journal.append({ type: "SagaAborted", sagaId: inst.sagaId, at: now });
        } else {
          this.journal.append({
            type: "SagaFailed",
            sagaId: inst.sagaId,
            error: inst.error ?? "failed",
            at: now,
          });
        }
      }
      return;
    }
  }
}
