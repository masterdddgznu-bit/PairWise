export function nextDeadline(now: number, electionTimeout: number, nodeId: number): number {
  return now + electionTimeout + nodeId;
}
