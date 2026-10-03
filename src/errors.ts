export class AdmitCtlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdmitCtlError";
  }
}
export class InvalidConfigError extends AdmitCtlError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class UnknownTenantError extends AdmitCtlError {
  constructor(id: string) {
    super(`unknown tenant: ${id}`);
    this.name = "UnknownTenantError";
  }
}
export class DuplicateRequestError extends AdmitCtlError {
  constructor(id: string) {
    super(`duplicate request: ${id}`);
    this.name = "DuplicateRequestError";
  }
}
export class InvalidStateError extends AdmitCtlError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}
