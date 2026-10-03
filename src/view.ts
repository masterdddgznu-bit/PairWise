export class ViewState {
  constructor(_start: number) {}
  current(): number {
    return 1;
  }
  change(_newView: number): void {}
}
