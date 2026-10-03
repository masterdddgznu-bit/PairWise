export class PageStore {
  private nextId = 1;
  private readonly values = new Map<number, string>();
  private readonly refs = new Map<number, number>();

  alloc(value: string): number {
    const id = this.nextId++;
    this.values.set(id, value);
    this.refs.set(id, 1);
    return id;
  }

  retain(id: number): void {
    const r = this.refs.get(id);
    if (r === undefined) return;
    this.refs.set(id, r + 1);
  }

  release(id: number): void {
    const r = this.refs.get(id);
    if (r === undefined) return;
    if (r <= 1) {
      this.refs.delete(id);
      this.values.delete(id);
    } else {
      this.refs.set(id, r - 1);
    }
  }

  get(id: number): string | undefined {
    return this.values.get(id);
  }

  refCount(id: number): number {
    return this.refs.get(id) ?? 0;
  }
}
