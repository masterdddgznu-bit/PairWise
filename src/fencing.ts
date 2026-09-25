export class FencingTokenRegistry {
  private readonly lastIssued = new Map<string, number>();

  nextToken(resourceId: string): number {
    const token = (this.lastIssued.get(resourceId) ?? 0) + 1;
    this.lastIssued.set(resourceId, token);
    return token;
  }

  maxIssued(resourceId: string): number {
    return this.lastIssued.get(resourceId) ?? 0;
  }
}
