export class TtlIndex {
  set(_pool: string, _resourceId: string, _expireAt: number): void {
    throw new Error("ttl set not implemented");
  }

  clear(_pool: string, _resourceId: string): void {
    // no-op on starte
  }

  expired(_now: number): Array<{ pool: string; resourceId: string }> {
    return [];
  }
}
