/** In-memory WAL segment — stub. */
export class Segment {
  readonly id: number;
  private readonly _lines: string[] = [];

  constructor(id: number) {
    this.id = id;
  }

  append(line: string): void {
    void line;
  }

  lines(): readonly string[] {
    return this._lines;
  }

  byteSize(): number {
    return 0;
  }

  clear(): void {
    this._lines.length = 0;
  }
}
