/** Value -> keys secondary index. Starter stub. */
export class SecondaryIndex {
  add(_key: string, _value: string): void {
    throw new Error("secindex add not implemented");
  }

  remove(_key: string, _value: string): void {
    throw new Error("secindex remove not implemented");
  }

  find(_value: string): string[] {
    throw new Error("secindex find not implemented");
  }

  clear(): void {}

  rebuild(_entries: [string, string][]): void {
    throw new Error("secindex rebuild not implemented");
  }
}
