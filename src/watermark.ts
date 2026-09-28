export class WatermarkTrack {
  private wm = -1;

  value(): number {
    return this.wm;
  }

  advance(t: number): void {
    if (t >= this.wm) this.wm = t;
  }
}
