export class FilterError extends Error {
  constructor(message = "Filter error") {
    super(message);
    this.name = "FilterError";
  }
}
