import { hash32 } from "./hash.js";
import type { Point } from "./types.js";

export class PointIndex {
  private readonly ringSize: number;
  private readonly list: Point[] = [];
  constructor(ringSize: number) { this.ringSize = ringSize; }
  clear(): void { this.list.length = 0; }
  addNodePoints(nodeId: string, weight: number): void {
    if (weight === 1) {
      this.list.push({ position: hash32(nodeId) % this.ringSize, nodeId });
    } else {
      for (let i = 0; i < weight; i++) {
        this.list.push({ position: hash32(`${nodeId}#${i}`) % this.ringSize, nodeId });
      }
    }
    this.sort();
  }
  removeNode(nodeId: string): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i]!.nodeId === nodeId) this.list.splice(i, 1);
    }
  }
  all(): Point[] { return this.list.map((p) => ({ ...p })); }
  private sort(): void {
    this.list.sort((a, b) =>
      a.position !== b.position ? a.position - b.position : a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0,
    );
  }
  ownerOf(pos: number): string | null {
    if (!this.list.length) return null;
    for (const p of this.list) if (p.position >= pos) return p.nodeId;
    return this.list[0]!.nodeId;
  }
}
