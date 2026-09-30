export class SketchError extends Error {
  constructor(message = "Sketch error") {
    super(message);
    this.name = "SketchError";
  }
}
