import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidOpenError,
  KeyBusyError,
  UnknownAssemblyError,
} from "./errors.js";

export type AssemblyStatus =
  | "open"
  | "ready"
  | "taken"
  | "expired"
  | "cancelled";

export interface PartWinOptions {
  clock: VirtualClock;
  maxOpen?: number;
  defaultTtlMs?: number;
}

export interface OpenOptions {
  ttlMs?: number;
}

export type PutResult = {
  status: "accepted" | "completed" | "rejected";
};

export interface TakeResult {
  assemblyId: number;
  key: string;
  parts: unknown[];
}

interface Assembly {
  id: number;
  key: string;
  parts: number;
  deadline: number;
  status: AssemblyStatus;
  slots: unknown[];
  occupied: boolean[];
  filled: number;
  completedAt: number | null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class PartWin {
  private readonly clock: VirtualClock;
  private readonly maxOpen: number;
  private readonly defaultTtlMs: number;
  private readonly assemblies = new Map<number, Assembly>();
  private nextId = 1;

  constructor(options: PartWinOptions) {
    const maxOpen = options.maxOpen ?? 8;
    const defaultTtlMs = options.defaultTtlMs ?? 100;
    if (!isPositiveInteger(maxOpen)) {
      throw new InvalidConfigError("maxOpen must be an integer >= 1");
    }
    if (!isPositiveInteger(defaultTtlMs)) {
      throw new InvalidConfigError("defaultTtlMs must be an integer >= 1");
    }
    this.clock = options.clock;
    this.maxOpen = maxOpen;
    this.defaultTtlMs = defaultTtlMs;
  }

  open(
    key: string,
    parts: number,
    opts: OpenOptions = {},
  ): { assemblyId: number } {
    if (typeof key !== "string" || key.length === 0) {
      throw new InvalidOpenError("key must be a non-empty string");
    }
    if (
      typeof parts !== "number" ||
      !Number.isInteger(parts) ||
      parts < 2
    ) {
      throw new InvalidOpenError("parts must be an integer >= 2");
    }
    const ttlMs = opts.ttlMs ?? this.defaultTtlMs;
    if (!isPositiveInteger(ttlMs)) {
      throw new InvalidOpenError("ttlMs must be an integer >= 1");
    }
    let openCount = 0;
    for (const assembly of this.assemblies.values()) {
      if (assembly.status !== "open") continue;
      if (assembly.key === key) {
        throw new KeyBusyError(`key "${key}" already has an open assembly`);
      }
      openCount += 1;
    }
    if (openCount >= this.maxOpen) {
      throw new CapacityError("maxOpen capacity reached");
    }
    const id = this.nextId++;
    this.assemblies.set(id, {
      id,
      key,
      parts,
      deadline: this.clock.now() + ttlMs,
      status: "open",
      slots: new Array(parts).fill(undefined),
      occupied: new Array(parts).fill(false),
      filled: 0,
      completedAt: null,
    });
    return { assemblyId: id };
  }

  put(assemblyId: number, partIndex: number, payload: unknown): PutResult {
    const assembly = this.get(assemblyId);
    if (
      typeof partIndex !== "number" ||
      !Number.isInteger(partIndex) ||
      partIndex < 0 ||
      partIndex >= assembly.parts
    ) {
      return { status: "rejected" };
    }
    if (assembly.status !== "open") {
      return { status: "rejected" };
    }
    if (this.clock.now() >= assembly.deadline) {
      return { status: "rejected" };
    }
    if (assembly.occupied[partIndex]) {
      return { status: "rejected" };
    }
    assembly.slots[partIndex] = payload;
    assembly.occupied[partIndex] = true;
    assembly.filled += 1;
    if (assembly.filled === assembly.parts) {
      assembly.status = "ready";
      assembly.completedAt = this.clock.now();
      return { status: "completed" };
    }
    return { status: "accepted" };
  }

  take(): TakeResult | null {
    const next = this.readySorted()[0];
    if (!next) return null;
    next.status = "taken";
    return {
      assemblyId: next.id,
      key: next.key,
      parts: next.slots.slice(),
    };
  }

  cancel(assemblyId: number): boolean {
    const assembly = this.get(assemblyId);
    if (assembly.status !== "open") return false;
    assembly.status = "cancelled";
    return true;
  }

  drive(): { expired: number[] } {
    const now = this.clock.now();
    const expired: number[] = [];
    for (const assembly of this.assemblies.values()) {
      if (assembly.status === "open" && now >= assembly.deadline) {
        assembly.status = "expired";
        expired.push(assembly.id);
      }
    }
    expired.sort((a, b) => a - b);
    return { expired };
  }

  statusOf(assemblyId: number): AssemblyStatus {
    return this.get(assemblyId).status;
  }

  openIds(): number[] {
    const ids: number[] = [];
    for (const assembly of this.assemblies.values()) {
      if (assembly.status === "open") ids.push(assembly.id);
    }
    return ids.sort((a, b) => a - b);
  }

  readyIds(): number[] {
    return this.readySorted().map((assembly) => assembly.id);
  }

  filledCount(assemblyId: number): number {
    return this.get(assemblyId).filled;
  }

  missingParts(assemblyId: number): number[] {
    const assembly = this.get(assemblyId);
    const missing: number[] = [];
    for (let index = 0; index < assembly.parts; index += 1) {
      if (!assembly.occupied[index]) missing.push(index);
    }
    return missing;
  }

  private get(assemblyId: number): Assembly {
    const assembly = this.assemblies.get(assemblyId);
    if (!assembly) {
      throw new UnknownAssemblyError(`unknown assemblyId ${assemblyId}`);
    }
    return assembly;
  }

  private readySorted(): Assembly[] {
    const ready: Assembly[] = [];
    for (const assembly of this.assemblies.values()) {
      if (assembly.status === "ready") ready.push(assembly);
    }
    return ready.sort(
      (a, b) =>
        (a.completedAt as number) - (b.completedAt as number) || a.id - b.id,
    );
  }
}
