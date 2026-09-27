export class SingleFlight {
  getOrLoad(_key: string, _loader: () => string): string {
    throw new Error("getOrLoad not implemented");
  }
}
