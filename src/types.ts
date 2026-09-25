export type SagaStatus =
  | "running"
  | "completed"
  | "compensating"
  | "aborted"
  | "failed";

export type StepHandler = (ctx: {
  sagaId: string;
  step: string;
  input: Record<string, unknown>;
  clock: number;
}) =>
  | { ok: true; output?: Record<string, unknown> }
  | { ok: false; error: string };

export type SagaStepDef = {
  name: string;
  timeout: number;
  compensate?: string;
};

export type SagaDef = {
  name: string;
  steps: SagaStepDef[];
};

export type SagaStatusView = {
  status: SagaStatus;
  completedSteps: string[];
  compensations: string[];
  error?: string;
};

export type JournalEvent =
  | { type: "SagaStarted"; sagaId: string; defName: string; input: Record<string, unknown>; at: number }
  | { type: "StepStarted"; sagaId: string; stepName: string; deadline: number; at: number }
  | { type: "StepCompleted"; sagaId: string; stepName: string; output: Record<string, unknown>; at: number }
  | { type: "StepFailed"; sagaId: string; stepName: string; error: string; at: number }
  | { type: "StepTimedOut"; sagaId: string; stepName: string; at: number }
  | { type: "CompensatingStarted"; sagaId: string; at: number }
  | { type: "StepCompensated"; sagaId: string; label: string; at: number }
  | { type: "SagaCompleted"; sagaId: string; at: number }
  | { type: "SagaFailed"; sagaId: string; error: string; at: number }
  | { type: "SagaAborted"; sagaId: string; at: number }
  | { type: "Effect"; sagaId: string; effect: string; at: number };

export type SagaInstance = {
  sagaId: string;
  defName: string;
  input: Record<string, unknown>;
  status: SagaStatus;
  stepIndex: number;
  completedSteps: string[];
  compensations: string[];
  compensateQueue: string[];
  compensateIndex: number;
  effects: string[];
  error?: string;
  currentStep?: string;
  stepDeadline?: number;
  timedOut?: boolean;
  pendingCompensateLabel?: string;
};
