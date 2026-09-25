export type RouteRule = [prefix: string, shardId: string];

/**
 * 最长前缀路由。
 */
export class Router {
  private readonly rules: RouteRule[];

  constructor(rules: RouteRule[]) {
    this.rules = rules.slice();
  }

  shardOf(key: string): string {
    let best: string | undefined;
    let bestLen = -1;
    for (const [prefix, shardId] of this.rules) {
      if (key.startsWith(prefix) && prefix.length > bestLen) {
        best = shardId;
        bestLen = prefix.length;
      }
    }
    if (best === undefined) {
      throw new Error(`no route for key: ${key}`);
    }
    return best;
  }

  shardsOf(keys: string[]): string[] {
    const set = new Set<string>();
    for (const key of keys) {
      set.add(this.shardOf(key));
    }
    return [...set].sort();
  }
}
