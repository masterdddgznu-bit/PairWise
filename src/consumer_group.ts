export interface PartitionAssignment {
  topic: string;
  partition: number;
}

export interface GroupMember {
  consumerId: string;
  topics: string[];
}

/** Consumer group membership + rebalance — stub assigns nothing. */
export class ConsumerGroupRegistry {
  join(_groupId: string, _consumerId: string, _topics: string[]): void {}

  leave(_groupId: string, _consumerId: string): void {}

  assigned(_groupId: string, _consumerId: string): PartitionAssignment[] {
    return [];
  }

  members(_groupId: string): GroupMember[] {
    return [];
  }
}
