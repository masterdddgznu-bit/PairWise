export class DebtLaneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DebtLaneError {}
export class InvalidLaneError extends DebtLaneError {}
export class InvalidTaskError extends DebtLaneError {}
export class UnknownTaskError extends DebtLaneError {}
