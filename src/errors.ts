export class ConfigError extends Error {
  constructor(message = "Invalid cluster configuration") {
    super(message);
    this.name = "ConfigError";
  }
}
