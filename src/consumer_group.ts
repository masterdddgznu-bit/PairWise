export interface PartitionAssignment {
  topic: string;
  partition: number;
}

export interface GroupMember {
  consumerId: string;
  topics: string[];
}

/** Consumer group membership with deterministic round-robin rebalance. */
export class ConsumerGroupRegistry {
  private groups = new Map<string, Map<string, string[]>>();
  private assignments = new Map<string, Map<string, PartitionAssignment[]>>();

  constructor(private partitionCountFor: (topic: string) => number) {}

  join(groupId: string, consumerId: string, topics: string[]): void {
    const members = this.groups.get(groupId) ?? new Map<string, string[]>();
    members.set(consumerId, [...topics]);
    this.groups.set(groupId, members);
    this.rebalance(groupId);
  }

  leave(groupId: string, consumerId: string): void {
    const members = this.groups.get(groupId);
    if (!members) return;
    members.delete(consumerId);
    if (members.size === 0) {
      this.groups.delete(groupId);
    }
    this.rebalance(groupId);
  }

  assigned(groupId: string, consumerId: string): PartitionAssignment[] {
    return [...(this.assignments.get(groupId)?.get(consumerId) ?? [])];
  }

  members(groupId: string): GroupMember[] {
    const members = this.groups.get(groupId);
    if (!members) return [];
    return [...members.entries()]
      .map(([consumerId, topics]) => ({ consumerId, topics: [...topics] }))
      .sort((a, b) => (a.consumerId < b.consumerId ? -1 : a.consumerId > b.consumerId ? 1 : 0));
  }

  private rebalance(groupId: string): void {
    const members = this.groups.get(groupId);
    const result = new Map<string, PartitionAssignment[]>();
    if (members) {
      for (const consumerId of members.keys()) {
        result.set(consumerId, []);
      }
      const topics = [...new Set([...members.values()].flat())].sort();
      for (const topic of topics) {
        const subscribed = [...members.entries()]
          .filter(([, memberTopics]) => memberTopics.includes(topic))
          .map(([consumerId]) => consumerId)
          .sort();
        if (subscribed.length === 0) continue;
        const partitionCount = this.partitionCountFor(topic);
        for (let partition = 0; partition < partitionCount; partition++) {
          const consumerId = subscribed[partition % subscribed.length];
          result.get(consumerId)!.push({ topic, partition });
        }
      }
      for (const list of result.values()) {
        list.sort((a, b) =>
          a.topic < b.topic
            ? -1
            : a.topic > b.topic
              ? 1
              : a.partition - b.partition,
        );
      }
    }
    this.assignments.set(groupId, result);
  }
}
