import { VirtualClock } from "./clock.js";
import { cloneDefinition, normalizeDefinition } from "./definition.js";
import { SagaError } from "./errors.js";
import { Journal } from "./journal.js";
import { newRuntime, viewOf } from "./runtime.js";
import { retryDelay } from "./backoff.js";
import { attemptKey } from "./attempt.js";
import { nextCompensation } from "./compensation.js";
import { replay } from "./replay.js";
import { decodeState, encodeState } from "./codec.js";
import { requireRunnable } from "./guards.js";
import type { ExportedState, JournalEntry, SagaDefinition, SagaRuntime, SagaView } from "./types.js";

export class SagaRunner {
  readonly clock: VirtualClock;
  private definitions = new Map<string, SagaDefinition>();
  private runtimes = new Map<string, SagaRuntime>();
  private journal = new Journal();
  private failures = new Map<string, string[]>();
  private completedAttempts = new Set<string>();
  private nextId = 1;

  constructor(clock = new VirtualClock()) {
    this.clock = clock;
  }

  registerDefinition(input: SagaDefinition): void {
    const def = normalizeDefinition(input);
    this.definitions.set(def.name, input);
  }

  begin(defName: string, input: Record<string, unknown> = {}, requestedId?: string): string {
    if (!this.definitions.has(defName)) throw new SagaError(`unknown definition: ${defName}`);
    const sagaId = requestedId ?? `s${this.nextId++}`;
    const runtime = newRuntime(sagaId, defName, input);
    this.runtimes.set(sagaId, runtime);
    this.journal.append({
      type: "SagaBegun",
      sagaId,
      at: this.clock.now(),
      defName,
      input,
    });
    return sagaId;
  }

  failNext(sagaId: string, error = "injected failure"): void {
    this.getRuntime(sagaId);
    this.failures.set(sagaId, [error]);
  }

  runNext(sagaId: string): SagaView {
    const runtime = this.getRuntime(sagaId);
    requireRunnable(runtime);
    const def = this.getDefinition(runtime.defName);
    if (runtime.status === "waiting-retry") return viewOf(runtime);

    if (runtime.status === "compensating") {
      const item = nextCompensation(runtime, def);
      if (!item) {
        runtime.status = "failed";
        this.journal.append({ type: "SagaFailed", sagaId, at: this.clock.now(), error: runtime.error ?? "failed" });
        return viewOf(runtime);
      }
      runtime.compensatedSteps.push(item.label);
      runtime.compensationIndex += 1;
      this.journal.append({ type: "StepCompensated", sagaId, at: this.clock.now(), step: item.step, label: item.label });
      return viewOf(runtime);
    }

    const step = def.steps[runtime.stepIndex];
    if (!step) {
      runtime.status = "completed";
      this.journal.append({ type: "SagaCompleted", sagaId, at: this.clock.now() });
      return viewOf(runtime);
    }
    const attempt = runtime.attempt + 1;
    const key = attemptKey(sagaId, step.name, attempt);
    if (this.completedAttempts.has(key)) return viewOf(runtime);
    this.journal.append({ type: "AttemptStarted", sagaId, at: this.clock.now(), step: step.name, attempt });
    runtime.attempt = attempt;
    const queue = this.failures.get(sagaId) ?? [];
    const error = queue.shift();
    if (error !== undefined) {
      const maxAttempts = step.maxAttempts ?? 1;
      if (attempt <= maxAttempts) {
        const retryAt = this.clock.now() + retryDelay(step.backoff ?? 0, attempt);
        runtime.status = "waiting-retry";
        runtime.retryAt = retryAt;
        runtime.error = error;
        this.journal.append({ type: "AttemptFailed", sagaId, at: this.clock.now(), step: step.name, attempt, error, retryAt });
      } else {
        runtime.status = "failed";
        runtime.error = error;
        this.journal.append({ type: "SagaFailed", sagaId, at: this.clock.now(), error });
      }
      return viewOf(runtime);
    }
    runtime.completedSteps.push(step.name);
    runtime.stepIndex += 1;
    runtime.attempt = 0;
    this.completedAttempts.add(key);
    this.journal.append({ type: "StepSucceeded", sagaId, at: this.clock.now(), step: step.name, attempt });
    return viewOf(runtime);
  }

  tick(ms: number): number {
    return this.clock.advance(ms);
  }

  status(sagaId: string): SagaView {
    return viewOf(this.getRuntime(sagaId));
  }

  journalEntries(sagaId?: string): JournalEntry[] {
    return this.journal.all(sagaId);
  }

  crashAndRecover(): void {
    this.completedAttempts.clear();
    this.runtimes = replay(this.journal.all());
  }

  exportState(): ExportedState {
    return encodeState({ version: 1, clock: this.clock.now(), nextId: 1, journal: this.journal.all() });
  }

  importState(value: unknown): void {
    const state = decodeState(value);
    this.clock.restore(state.clock);
    this.journal.restore(state.journal);
    this.runtimes = replay(state.journal);
  }

  private getRuntime(sagaId: string): SagaRuntime {
    const runtime = this.runtimes.get(sagaId);
    if (!runtime) throw new SagaError(`unknown saga: ${sagaId}`);
    return runtime;
  }

  private getDefinition(name: string): SagaDefinition {
    const def = this.definitions.get(name);
    if (!def) throw new SagaError(`unknown definition: ${name}`);
    return def;
  }
}
