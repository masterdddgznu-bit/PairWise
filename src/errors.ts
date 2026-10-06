export class SchemaEvoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SchemaEvoError";
    this.code = code;
    Object.setPrototypeOf(this, SchemaEvoError.prototype);
  }
}

export function fail(code: string, message: string): never {
  throw new SchemaEvoError(code, message);
}
