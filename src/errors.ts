export class WaterMeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WaterMeshError";
  }
}
export class InvalidConfigError extends WaterMeshError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class InvalidEventError extends WaterMeshError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventError";
  }
}
export class InvalidWatermarkError extends WaterMeshError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWatermarkError";
  }
}
export class InvalidCheckpointError extends WaterMeshError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCheckpointError";
  }
}
