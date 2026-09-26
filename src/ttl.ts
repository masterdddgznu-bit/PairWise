export class TtlIndex {
  set(_key: string, _expireAt: number): void {
    throw new Error("ttl set not implemented");
  }

  clear(_key: string): void {
    // harmless no-op for base set
  }

  expiredKeys(_now: number): string[] {
    return [];
  }
}
