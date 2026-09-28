import type { SessionAgg, StreamEvent } from "./types.js";

export class SessionWindows {
  enable(_gap: number): void {
    throw new Error("session not implemented");
  }

  enabled(): boolean {
    return false;
  }

  onEvent(_ev: StreamEvent): void {
    throw new Error("session onEvent not implemented");
  }

  onWatermark(_watermark: number, _allowed: number): void {
    throw new Error("session onWatermark not implemented");
  }

  results(): SessionAgg[] {
    throw new Error("session results not implemented");
  }
}
