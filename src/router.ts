export type RouteRule = [prefix: string, shardId: string];

/**
 * 最长前缀路由。起始实现未完成。
 */
export class Router {
  constructor(_rules: RouteRule[]) {
    throw new Error("not implemented");
  }

  shardOf(_key: string): string {
    throw new Error("not implemented");
  }

  shardsOf(_keys: string[]): string[] {
    throw new Error("not implemented");
  }
}
