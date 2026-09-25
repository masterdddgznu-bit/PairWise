export interface PartitionAssignment {
  topic: string;
  partition: number;
}

export interface GroupMember {
  consumerId: string;
  topics: string[];
}

/**
 * Consumer group membership with deterministic, lazily computed assignment:
 * per topic, sorted subscriber ids, partition i goes to subscribers[i % n].
 */
export class ConsumerGroupRegistry {
  private groups = new Map<string, Map<string, GroupMember>>();

  join(groupId: string, consumerId: string, topics: string[]): void {
    let group = this.groups.get(groupId);
    if (!group) {
      group = new Map();
      this.groups.set(groupId, group);
    }
    group.set(consumerId, { consumerId, topics: [...topics] });
  }

  leave(groupId: string, consumerId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    group.delete(consumerId);
    if (group.size === 0) this.groups.delete(groupId);
  }

  members(groupId: string): GroupMember[] {
    const group = this.groups.get(groupId);
    if (!group) return [];
    return [...group.values()]
      .map((m) => ({ consumerId: m.consumerId, topics: [...m.topics] }))
      .sort((a, b) => (a.consumerId < b.consumerId ? -1 : a.consumerId > b.consumerId ? 1 : 0));
  }

  assigned(
    groupId: string,
    consumerId: string,
    partitionCount: (topic: string) => number,
  ): PartitionAssignment[] {
    const group = this.groups.get(groupId);
    const me = group?.get(consumerId);
    if (!group || !me) return [];
    const members = this.members(groupId);
    const result: PartitionAssignment[] = [];
    for (const topic of me.topics) {
      const subscribers = members.filter((m) => m.topics.includes(topic));
      const myIndex = subscribers.findIndex((m) => m.consumerId === consumerId);
      if (myIndex < 0 || subscribers.length === 0) continue;
      const count = partitionCount(topic);
      for (let p = 0; p < count; p++) {
        if (p % subscribers.length === myIndex) {
          result.push({ topic, partition: p });
        }
      }
    }
    return result;
  }
}
