import type { SagaDef, StepHandler } from "./types.js";

/** In-memory registry of saga definitions and handlers. */
export class Registry {
  private defs = new Map<string, SagaDef>();
  private handlers = new Map<string, Record<string, StepHandler>>();
  private compensateHandlers = new Map<string, Record<string, StepHandler>>();

  register(def: SagaDef, stepHandlers: Record<string, StepHandler>): void {
    this.defs.set(def.name, def);
    this.handlers.set(def.name, stepHandlers);
  }

  registerCompensate(defName: string, handlers: Record<string, StepHandler>): void {
    this.compensateHandlers.set(defName, handlers);
  }

  getDef(name: string): SagaDef | undefined {
    return this.defs.get(name);
  }

  getHandlers(defName: string): Record<string, StepHandler> | undefined {
    return this.handlers.get(defName);
  }

  getCompensateHandlers(defName: string): Record<string, StepHandler> | undefined {
    return this.compensateHandlers.get(defName);
  }
}
