export type StepState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "rolling_back"
  | "rolled_back";

export interface StepDef {
  id: string;
  deps: string[];
  /** logical ticks to wait before retry; empty = no retry */
  retryDelays?: number[];
  /** compensation label for assertions */
  compensate?: string;
}

export interface WorkflowDef {
  id: string;
  steps: StepDef[];
}

export interface StepResult {
  value: string;
  generation: number;
}

export interface StepRuntime {
  id: string;
  state: StepState;
  generation: number;
  attempt: number;
  nextRetryAt?: number;
  result?: StepResult;
  lastError?: string;
}

export interface RunSnapshot {
  runId: string;
  workflowId: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "rolling_back" | "rolled_back";
  cancelRequested: boolean;
  steps: Record<string, StepRuntime>;
  compensations: string[];
}
