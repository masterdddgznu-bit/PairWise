export interface Channel {
  id: string;
  payload: unknown;
  openAt: number;
  shutAt: number;
  gulps: number;
}

export interface ChannelView {
  id: string;
  payload: unknown;
  openAt: number;
  shutAt: number;
  gulps: number;
}

export function viewOf(channel: Channel): ChannelView {
  return {
    id: channel.id,
    payload: channel.payload,
    openAt: channel.openAt,
    shutAt: channel.shutAt,
    gulps: channel.gulps,
  };
}

export class ChannelRegistry {
  #channels = new Map<string, Channel>();

  get size(): number {
    return this.#channels.size;
  }

  get(id: string): Channel | undefined {
    return this.#channels.get(id);
  }

  has(id: string): boolean {
    return this.#channels.has(id);
  }

  add(channel: Channel): void {
    this.#channels.set(channel.id, channel);
  }

  remove(id: string): boolean {
    return this.#channels.delete(id);
  }

  ids(): string[] {
    return [...this.#channels.keys()];
  }

  entries(): Channel[] {
    return [...this.#channels.values()];
  }
}
