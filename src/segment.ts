/** A newline-delimited, in-memory WAL segment. */
export class Segment {
  readonly id: number;
  private readonly _lines: string[] = [];
  private _byteSize = 0;

  constructor(id: number) {
    this.id = id;
  }

  append(line: string): void {
    this._lines.push(line);
    this._byteSize += line.length + 1;
  }

  lines(): readonly string[] {
    return this._lines;
  }

  byteSize(): number {
    return this._byteSize;
  }

  clear(): void {
    this._lines.length = 0;
    this._byteSize = 0;
  }
}
