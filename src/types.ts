export type SagaStatus = "running" | "waiting-retry" | "compensating" | "completed" | "failed";
export type SagaStep = { name: string; maxAttempts?: number; backoff?: number; compensate?: string };
export type SagaDefinition = { name: string; steps: SagaStep[] };
export type JournalEntry =
  | { seq: number; type: "SagaBegun"; sagaId: string; at: number; defName: string; input: Record<string, unknown> }
  | { seq: number; type: "AttemptStarted"; sagaId: string; at: number; step: string; attempt: number }
  | { seq: number; type: "StepSucceeded"; sagaId: string; at: number; step: string; attempt: number }
  | { seq: number; type: "AttemptFailed"; sagaId: string; at: number; step: string; attempt: number; error: string; retryAt?: number }
  | { seq: number; type: "CompensationStarted"; sagaId: string; at: number; error: string }
  | { seq: number; type: "StepCompensated"; sagaId: string; at: number; step: string; label: string }
  | { seq: number; type: "SagaCompleted"; sagaId: string; at: number }
  | { seq: number; type: "SagaFailed"; sagaId: string; at: number; error: string };

export type SagaView = {
  sagaId: string;
  defName: string;
  status: SagaStatus;
  stepIndex: number;
  completedSteps: string[];
  compensatedSteps: string[];
  attempt: number;
  retryAt?: number;
  error?: string;
};

export type SagaRuntime = SagaView & {
  input: Record<string, unknown>;
};

export type ExportedState = {
  version: 1;
  clock: number;
  nextId: number;
  journal: JournalEntry[];
};
