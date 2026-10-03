import { PointIndex } from "./points.js";
export class RingState {
  readonly points: PointIndex;
  readonly nodeWeights = new Map<string, number>();
  constructor(ringSize: number) { this.points = new PointIndex(ringSize); }
}
