/** Committed offsets per group/topic/partition; unset means 0. */
export class OffsetManager {
  private committed = new Map<string, number>();

  private key(groupId: string, topic: string, partition: number): string {
    return `${groupId}|${topic}|${partition}`;
  }

  getCommitted(groupId: string, topic: string, partition: number): number {
    return this.committed.get(this.key(groupId, topic, partition)) ?? 0;
  }

  setCommitted(groupId: string, topic: string, partition: number, offset: number): void {
    this.committed.set(this.key(groupId, topic, partition), offset);
  }
}
