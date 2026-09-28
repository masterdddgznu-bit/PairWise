export class IdRegistry {
  private readonly seen = new Set<string>();

  /** @returns true if first time */
  check(_id: string): boolean {
    throw new Error("idempotency not implemented");
  }
}
