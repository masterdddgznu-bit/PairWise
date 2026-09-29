/** Simple cartesian join buffer (base mode). */
export class JoinBuffer {
  private readonly left = new Map<string, string>();
  private readonly right = new Map<string, string>();

  pushLeft(id: string, value: string): void {
    this.left.set(id, value);
  }

  pushRight(id: string, value: string): void {
    this.right.set(id, value);
  }

  drain(): { left: string; right: string }[] {
    const out: { left: string; right: string }[] = [];
    for (const lv of this.left.values()) {
      for (const rv of this.right.values()) {
        out.push({ left: lv, right: rv });
      }
    }
    this.left.clear();
    this.right.clear();
    return out;
  }

  leftSize(): number {
    return this.left.size;
  }

  rightSize(): number {
    return this.right.size;
  }

  clear(): void {
    this.left.clear();
    this.right.clear();
  }
}
