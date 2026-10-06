export type SchemaEvoErrorCode =
  | "SUBJECT_EXISTS"
  | "NO_SUCH_SUBJECT"
  | "SUBJECT_CAPACITY"
  | "NO_SUCH_VERSION"
  | "VERSION_CAPACITY"
  | "PREDECESSOR_RETIRED"
  | "CONSUMER_EXISTS"
  | "NO_SUCH_CONSUMER"
  | "CONSUMER_CAPACITY"
  | "ROLLOUT_ACTIVE"
  | "ROLLOUT_CAPACITY"
  | "NO_SUCH_ROLLOUT"
  | "ROLLOUT_CLOSED"
  | "NOT_MEMBER"
  | "ACK_CONFLICT"
  | "ACKS_PENDING"
  | "INCOMPATIBLE"
  | "TARGET_RETIRED"
  | "RETIRE_CURRENT"
  | "RETIRE_IN_USE"
  | "RETIRE_ACTIVE"
  | "RETIRE_NO_SUCCESSOR"
  | "JOURNAL_SEQUENCE"
  | "JOURNAL_ENTRY";

export class SchemaEvoError extends Error {
  readonly code: SchemaEvoErrorCode;

  constructor(code: SchemaEvoErrorCode, message: string) {
    super(message);
    this.name = "SchemaEvoError";
    this.code = code;
    Object.setPrototypeOf(this, SchemaEvoError.prototype);
  }
}

export function fail(code: SchemaEvoErrorCode, message: string): never {
  throw new SchemaEvoError(code, message);
}
