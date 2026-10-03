export class WatchBusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchBusError";
  }
}
export class InvalidConfigError extends WatchBusError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class InvalidTopicError extends WatchBusError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTopicError";
  }
}
export class FeatureNotReadyError extends WatchBusError {
  constructor(message: string) {
    super(message);
    this.name = "FeatureNotReadyError";
  }
}
