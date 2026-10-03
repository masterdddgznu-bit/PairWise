export class WatermarkTrack {
  current(): number {
    return Number.NEGATIVE_INFINITY;
  }
  raise(_wm: number): void {}
  exportAll(): number {
    return Number.NEGATIVE_INFINITY;
  }
  importAll(_wm: number): void {}
}
