import { InvalidViewError } from "./errors.js";

export class ViewState {
  private view: number;

  constructor(start: number) {
    this.view = start;
  }

  current(): number {
    return this.view;
  }

  change(newView: number): void {
    if (!Number.isInteger(newView) || newView <= this.view) {
      throw new InvalidViewError(
        `view must be an integer greater than ${this.view}, got ${newView}`,
      );
    }
    this.view = newView;
  }

  restore(view: number): void {
    this.view = view;
  }
}
