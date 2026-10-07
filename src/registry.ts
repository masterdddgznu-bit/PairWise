export interface Line {
  id: string;
  payload: unknown;
  hitchAt: number;
  castAt: number;
  turns: number;
}

export interface LineSnapshot {
  id: string;
  payload: unknown;
  hitchAt: number;
  castAt: number;
  turns: number;
}

export function snapshotOf(line: Line): LineSnapshot {
  return {
    id: line.id,
    payload: line.payload,
    hitchAt: line.hitchAt,
    castAt: line.castAt,
    turns: line.turns,
  };
}

/**
 * Registration window store. Map insertion order doubles as the
 * first-admission order, which updates never disturb.
 */
export class Registry {
  private readonly lines = new Map<string, Line>();

  has(id: string): boolean {
    return this.lines.has(id);
  }

  get(id: string): Line | undefined {
    return this.lines.get(id);
  }

  add(line: Line): void {
    this.lines.set(line.id, line);
  }

  remove(id: string): boolean {
    return this.lines.delete(id);
  }

  get size(): number {
    return this.lines.size;
  }

  /** All registered lines in first-admission order. */
  inOrder(): Line[] {
    return [...this.lines.values()];
  }
}
