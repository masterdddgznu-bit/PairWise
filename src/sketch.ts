/** IBLT-lite bucket sketch — starter stub. */
export class Sketch {
  constructor(_buckets: number) {
    throw new Error("Sketch not implemented");
  }

  add(_key: string): void {
    throw new Error("Sketch add not implemented");
  }

  static fromKeys(_keys: string[], _buckets: number): Sketch {
    throw new Error("Sketch fromKeys not implemented");
  }

  diff(_other: Sketch, _candidates?: string[]): string[] {
    throw new Error("Sketch diff not implemented");
  }
}
