export class MaglevError extends Error {
  constructor(message = "Maglev error") {
    super(message);
    this.name = "MaglevError";
  }
}
