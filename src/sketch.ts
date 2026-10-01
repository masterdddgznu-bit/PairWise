import { ThetaError } from "./errors.js";
import type { ThetaState, ThetaStats } from "./types.js";

/** Theta Sketch distinct-count estimator — starter stub. */
export class ThetaSketch {
  constructor(_k: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_key: string): void {
    throw new Error("add not implemented");
  }

  estimate(): number {
    throw new Error("estimate not implemented");
  }

  thetaValue(): number {
    throw new Error("thetaValue not implemented");
  }

  retained(): number {
    throw new Error("retained not implemented");
  }

  merge(_other: ThetaSketch): void {
    throw new Error("merge not implemented");
  }

  exportState(): ThetaState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: ThetaState): ThetaSketch {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): ThetaStats {
    throw new Error("stats not implemented");
  }
}
