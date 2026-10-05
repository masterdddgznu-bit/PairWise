export class CapChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CapChainError {}
export class InvalidMintError extends CapChainError {}
export class InvalidDeriveError extends CapChainError {}
export class UnknownCapError extends CapChainError {}
export class InvalidRevokeError extends CapChainError {}
