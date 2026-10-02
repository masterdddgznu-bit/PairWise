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
    if (this.definitions.has(def.name)) throw new SagaError(`duplicate definition: ${def.name}`);
    this.definitions.set(def.name, cloneDefinition(def));
  }

  begin(defName: string, input: Record<string, unknown> = {}, requestedId?: string): string {
    if (!this.definitions.has(defName)) throw new SagaError(`unknown definition: ${defName}`);
    let sagaId: string;
    if (requestedId !== undefined) {
      if (this.runtimes.has(requestedId)) throw new SagaError(`duplicate saga id: ${requestedId}`);
      sagaId = requestedId;
    } else {
      do {
        sagaId = `s${this.nextId++}`;
      } while (this.runtimes.has(sagaId));
    }
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
    const queue = this.failures.get(sagaId) ?? [];
    queue.push(error);
    this.failures.set(sagaId, queue);
  }

  runNext(sagaId: string): SagaView {
    const runtime = this.getRuntime(sagaId);
    requireRunnable(runtime);
    this.promote(runtime);
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
      if (runtime.compensationIndex >= runtime.completedSteps.length) {
        runtime.status = "failed";
        this.journal.append({ type: "SagaFailed", sagaId, at: this.clock.now(), error: runtime.error ?? "failed" });
      }
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
      runtime.error = error;
      if (attempt < maxAttempts) {
        const retryAt = this.clock.now() + retryDelay(step.backoff ?? 0, attempt);
        runtime.status = "waiting-retry";
        runtime.retryAt = retryAt;
        this.journal.append({ type: "AttemptFailed", sagaId, at: this.clock.now(), step: step.name, attempt, error, retryAt });
      } else if (runtime.completedSteps.length > 0) {
        runtime.status = "compensating";
        this.journal.append({ type: "CompensationStarted", sagaId, at: this.clock.now(), error });
      } else {
        runtime.status = "failed";
        this.journal.append({ type: "SagaFailed", sagaId, at: this.clock.now(), error });
      }
      return viewOf(runtime);
    }
    runtime.completedSteps.push(step.name);
    runtime.stepIndex += 1;
    runtime.attempt = 0;
    runtime.error = undefined;
    this.completedAttempts.add(key);
    this.journal.append({ type: "StepSucceeded", sagaId, at: this.clock.now(), step: step.name, attempt });
    return viewOf(runtime);
  }

  tick(ms: number): number {
    const now = this.clock.advance(ms);
    for (const runtime of this.runtimes.values()) this.promote(runtime);
    return now;
  }

  status(sagaId: string): SagaView {
    const runtime = this.getRuntime(sagaId);
    this.promote(runtime);
    return viewOf(runtime);
  }

  journalEntries(sagaId?: string): JournalEntry[] {
    return this.journal.all(sagaId);
  }

  crashAndRecover(): void {
    this.failures.clear();
    this.rebuild(this.journal.all());
  }

  exportState(): ExportedState {
    return encodeState({ version: 1, clock: this.clock.now(), nextId: this.nextId, journal: this.journal.all() });
  }

  importState(value: unknown): void {
    const state = decodeState(value);
    for (const entry of state.journal) {
      if (entry.type === "SagaBegun" && !this.definitions.has(entry.defName)) {
        throw new SagaError(`unknown definition: ${entry.defName}`);
      }
    }
    this.clock.restore(state.clock);
    this.nextId = state.nextId;
    this.journal.restore(state.journal);
    this.failures.clear();
    this.rebuild(state.journal);
  }

  private promote(runtime: SagaRuntime): void {
    if (
      runtime.status === "waiting-retry" &&
      runtime.retryAt !== undefined &&
      this.clock.now() >= runtime.retryAt
    ) {
      runtime.status = "running";
      runtime.retryAt = undefined;
    }
  }

  private rebuild(rows: JournalEntry[]): void {
    this.runtimes = replay(rows);
    this.completedAttempts = new Set();
    for (const entry of rows) {
      if (entry.type === "StepSucceeded") {
        this.completedAttempts.add(attemptKey(entry.sagaId, entry.step, entry.attempt));
      }
    }
    for (const runtime of this.runtimes.values()) this.promote(runtime);
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
