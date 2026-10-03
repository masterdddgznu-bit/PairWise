import { UnknownPinError } from "./errors.js";

export class PinBook {
  private pins = new Map<string, { epoch: number; deadline: number | null }>();

  pin(pinId: string, epoch: number, deadline: number | null): void {
    this.pins.set(pinId, { epoch, deadline });
  }

  unpin(pinId: string): boolean {
    return this.pins.delete(pinId);
  }

  epochOf(pinId: string): number {
    const p = this.pins.get(pinId);
    if (!p) throw new UnknownPinError(`unknown pin: ${pinId}`);
    return p.epoch;
  }

  has(pinId: string): boolean {
    return this.pins.has(pinId);
  }

  ids(): string[] {
    return [...this.pins.keys()].sort();
  }

  epochs(): number[] {
    return [...this.pins.values()].map((p) => p.epoch);
  }

  expired(now: number): string[] {
    const out: string[] = [];
    for (const [id, p] of this.pins) {
      if (p.deadline !== null && now >= p.deadline) out.push(id);
    }
    return out.sort();
  }
}
