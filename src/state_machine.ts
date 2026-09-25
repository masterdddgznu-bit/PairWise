import type { StepState } from "./types.js";

const allowed: Record<StepState, StepState[]> = {
  pending: ["running", "cancelled"],
  running: ["succeeded", "failed", "cancelled", "rolling_back"],
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
   * Apply transition. cancelRequested should block running→succeeded.
   */
  transition(
    from: StepState,
    to: StepState,
    cancelRequested: boolean,
  ): StepState {
    if (!this.can(from, to)) throw new Error(`bad transition ${from}->${to}`);
    if (cancelRequested && from === "running" && to === "succeeded") {
      throw new Error(`bad transition ${from}->${to} (cancel requested)`);
    }
    return to;
  }
}
