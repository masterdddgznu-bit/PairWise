export interface Message {
  topic: string;
  offset: number;
  payload: string;
}

/** Append-only per-topic log. Mostly complete. */
export class MessageStore {
  private topics = new Map<string, Message[]>();

  ensureTopic(topic: string): void {
    if (!this.topics.has(topic)) this.topics.set(topic, []);
  }

  publish(topic: string, payload: string): number {
    this.ensureTopic(topic);
    const list = this.topics.get(topic)!;
    const offset = list.length + 1;
    list.push({ topic, offset, payload });
    return offset;
  }

  get(topic: string, offset: number): Message | undefined {
    const list = this.topics.get(topic);
    if (!list) return undefined;
    return list[offset - 1];
  }

  nextOffset(topic: string): number {
    const list = this.topics.get(topic);
    return (list?.length ?? 0) + 1;
  }

  lastOffset(topic: string): number {
    const list = this.topics.get(topic);
    return list?.length ?? 0;
  }

  topicCount(): number {
    return this.topics.size;
  }

  messageCount(): number {
    let n = 0;
    for (const list of this.topics.values()) n += list.length;
    return n;
  }
}
