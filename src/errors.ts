export class DeltaMapError extends Error {
  constructor(message = "DeltaMap error") {
    super(message);
    this.name = "DeltaMapError";
  }
}
