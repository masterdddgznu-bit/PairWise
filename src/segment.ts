/** In-memory WAL segment. */
export class Segment {
  readonly id: number;
  private readonly _lines: string[] = [];
  private bytes = 0;

  constructor(id: number) {
    this.id = id;
  }

  append(line: string): void {
    this._lines.push(line);
    this.bytes += line.length + 1;
  }

  lines(): readonly string[] {
    return this._lines;
  }

  byteSize(): number {
    return this.bytes;
  }

  clear(): void {
    this._lines.length = 0;
    this.bytes = 0;
  }
}
