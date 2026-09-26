import type { Replica } from "./replica.js";

/** Pull missing updates by comparing version vectors — stub no-op. */
export function syncReplica(_from: Replica, _to: Replica): void {
  /* stub */
}

export function syncAllPairs(replicas: Replica[]): void {
  void replicas;
}
