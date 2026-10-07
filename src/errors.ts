export class RimeVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RimeVaultError {}
export class InvalidIdError extends RimeVaultError {}
export class InvalidSpanError extends RimeVaultError {}
export class InvalidChillError extends RimeVaultError {}
export class InvalidAmountError extends RimeVaultError {}
export class CapacityError extends RimeVaultError {}
export class UnknownIdError extends RimeVaultError {}
