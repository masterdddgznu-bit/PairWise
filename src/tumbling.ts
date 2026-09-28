import type { Agg, StreamEvent } from "./types.js";

export class TumblingWindows {
  enable(_size: number): void {
    throw new Error("tumbling not implemented");
  }

  enabled(): boolean {
    return false;
  }

  onEvent(_ev: StreamEvent, _watermark: number, _allowed: number): "ok" | "late" {
    throw new Error("tumbling onEvent not implemented");
  }

  onWatermark(_watermark: number, _allowed: number): void {
    throw new Error("tumbling onWatermark not implemented");
  }

  result(_start: number): Agg[] {
    throw new Error("tumbling result not implemented");
  }

  closed(): number[] {
    return [];
  }

  snapshot(_start: number): Agg[] | null {
    return null;
  }
}
