export class ShardBagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends ShardBagError {}
export class InvalidJobError extends ShardBagError {}
export class UnknownTicketError extends ShardBagError {}
export class FenceError extends ShardBagError {}
