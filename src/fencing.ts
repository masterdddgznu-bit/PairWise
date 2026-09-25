/** Per-resource monotonic fencing tokens — stub always returns 0. */
export class FencingTokenRegistry {
  nextToken(_resourceId: string): number {
    return 0;
  }

  maxIssued(_resourceId: string): number {
    return 0;
  }
}
