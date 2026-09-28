import type { Replica } from "./replica.js";

export function activeChain(replicas: Replica[]): number[] {
  return replicas.filter((r) => r.online).map((r) => r.id);
}
