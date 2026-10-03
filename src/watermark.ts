import { InvalidWatermarkError } from "./errors.js";

export class WatermarkTrack {
  private wm = Number.NEGATIVE_INFINITY;
  current(): number {
    return this.wm;
  }
  raise(wm: number): void {
    if (!Number.isFinite(wm)) {
      throw new InvalidWatermarkError("watermark must be finite");
    }
    if (wm < this.wm) {
      throw new InvalidWatermarkError("watermark cannot move backwards");
    }
    this.wm = wm;
  }
  exportAll(): number {
    return this.wm;
  }
  importAll(wm: number): void {
    this.wm = wm;
  }
}
