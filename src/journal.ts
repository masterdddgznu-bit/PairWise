import type { JournalEvent, SagaInstance, SagaStatus } from "./types.js";

/** Append-only saga journal with replay for crash recovery. */
export class Journal {
  private events: JournalEvent[] = [];

  append(event: JournalEvent): void {
    this.events.push(event);
  }

  all(): JournalEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  restore(events: JournalEvent[]): void {
    this.events = events.map((e) => ({ ...e }));
  }

  rebuildInstances(): Map<string, SagaInstance> {
    const map = new Map<string, SagaInstance>();

    for (const ev of this.events) {
      if (ev.type === "SagaStarted") {
        map.set(ev.sagaId, {
          sagaId: ev.sagaId,
          defName: ev.defName,
          input: { ...ev.input },
          status: "running",
          stepIndex: 0,
          completedSteps: [],
          compensations: [],
          compensateQueue: [],
          compensateIndex: 0,
          effects: [],
        });
        continue;
      }

      const inst = map.get(ev.sagaId);
      if (!inst) continue;

      switch (ev.type) {
        case "StepStarted":
          inst.currentStep = ev.stepName;
          inst.stepDeadline = ev.deadline;
          inst.timedOut = false;
          break;
        case "StepCompleted":
          inst.completedSteps.push(ev.stepName);
          inst.stepIndex = inst.completedSteps.length;
          inst.currentStep = undefined;
          inst.stepDeadline = undefined;
          break;
        case "StepFailed":
        case "StepTimedOut":
          inst.error = ev.type === "StepFailed" ? ev.error : "timeout";
          inst.status = "compensating";
          inst.currentStep = undefined;
          inst.stepDeadline = undefined;
          break;
        case "CompensatingStarted":
          inst.status = "compensating";
          inst.currentStep = undefined;
          inst.stepDeadline = undefined;
          break;
        case "StepCompensated":
          inst.compensations.push(ev.label);
          inst.compensateIndex += 1;
          break;
        case "SagaCompleted":
          inst.status = "completed";
          inst.currentStep = undefined;
          break;
        case "SagaFailed":
          inst.status = "failed";
          inst.error = ev.error;
          break;
        case "SagaAborted":
          inst.status = "aborted";
          break;
        case "Effect":
          inst.effects.push(ev.effect);
          break;
      }
    }

    return map;
  }

  latestStatus(sagaId: string): SagaStatus | undefined {
    return this.rebuildInstances().get(sagaId)?.status;
  }
}
