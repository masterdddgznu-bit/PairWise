import type { StepState } from "./types.js";

const allowed: Record<StepState, StepState[]> = {
  pending: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: ["rolling_back", "pending"],
  failed: ["pending", "rolling_back", "cancelled"],
  cancelled: [],
  rolling_back: ["rolled_back"],
  rolled_back: ["pending"],
};

export class StateMachine {
  can(from: StepState, to: StepState): boolean {
    return allowed[from]?.includes(to) ?? false;
  }

  /**
   * Apply transition. A requested cancel blocks any forward progress
   * (pending/running -> running/succeeded).
   */
  transition(
    from: StepState,
    to: StepState,
    cancelRequested: boolean,
  ): StepState {
    if (!this.can(from, to)) throw new Error(`bad transition ${from}->${to}`);
    if (cancelRequested && (to === "running" || to === "succeeded")) {
      throw new Error(`transition ${from}->${to} rejected: cancel requested`);
    }
    return to;
  }
}
