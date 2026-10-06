import { CapacityError, ConflictError, StateError } from "./errors.js";
import { assertIdentifier } from "./validate.js";

export interface RotationState {
  fromEpoch: string;
  toEpoch: string;
  remaining: number;
}

export interface TenantState {
  currentEpoch: string;
  retiredEpochs: string[];
  rotation?: RotationState;
  objects: Map<string, string>;
}

export interface RotationPlan {
  fromEpoch: string;
  toEpoch: string;
  objects: string[];
}

export class Catalog {
  private readonly tenants = new Map<string, TenantState>();
  private objectCount = 0;

  constructor(
    private readonly maxTenants: number,
    private readonly maxObjects: number,
  ) {}

  getTenant(tenant: string): TenantState {
    const state = this.tenants.get(tenant);
    if (!state) throw new StateError(`unknown tenant: ${tenant}`);
    return state;
  }

  registerTenant(tenant: string, initialEpoch: string): void {
    assertIdentifier(tenant, "tenant");
    assertIdentifier(initialEpoch, "epoch");
    if (this.tenants.has(tenant)) throw new ConflictError(`tenant already registered: ${tenant}`);
    if (this.tenants.size >= this.maxTenants) throw new CapacityError("tenant capacity reached");
    this.tenants.set(tenant, { currentEpoch: initialEpoch, retiredEpochs: [], objects: new Map() });
  }

  registerObject(tenant: string, objectId: string): void {
    assertIdentifier(tenant, "tenant");
    assertIdentifier(objectId, "objectId");
    const state = this.getTenant(tenant);
    if (state.objects.has(objectId)) throw new ConflictError(`object already registered: ${objectId}`);
    if (this.objectCount >= this.maxObjects) throw new CapacityError("object capacity reached");
    state.objects.set(objectId, state.currentEpoch);
    this.objectCount += 1;
  }

  objectEpoch(tenant: string, objectId: string): string {
    const state = this.getTenant(tenant);
    const epoch = state.objects.get(objectId);
    if (epoch === undefined) throw new StateError(`unknown object: ${objectId}`);
    return epoch;
  }

  setObjectEpoch(tenant: string, objectId: string, epoch: string): void {
    const state = this.getTenant(tenant);
    if (!state.objects.has(objectId)) throw new StateError(`unknown object: ${objectId}`);
    state.objects.set(objectId, epoch);
  }

  planRotation(tenant: string, toEpoch: string): RotationPlan {
    assertIdentifier(toEpoch, "epoch");
    const state = this.getTenant(tenant);
    if (state.rotation) throw new StateError(`rotation already active for tenant: ${tenant}`);
    if (state.currentEpoch === toEpoch) throw new StateError("new epoch must differ from current epoch");
    const objects: string[] = [];
    for (const [objectId, epoch] of state.objects) {
      if (epoch === state.currentEpoch) objects.push(objectId);
    }
    return { fromEpoch: state.currentEpoch, toEpoch, objects };
  }

  commitRotation(tenant: string, plan: RotationPlan): void {
    const state = this.getTenant(tenant);
    state.rotation = { fromEpoch: plan.fromEpoch, toEpoch: plan.toEpoch, remaining: plan.objects.length };
    state.currentEpoch = plan.toEpoch;
  }

  decrementRotationRemaining(tenant: string): void {
    const state = this.getTenant(tenant);
    if (!state.rotation) throw new StateError(`no active rotation for tenant: ${tenant}`);
    state.rotation.remaining -= 1;
  }

  retire(tenant: string, epoch: string): RotationState {
    assertIdentifier(epoch, "epoch");
    const state = this.getTenant(tenant);
    const rotation = state.rotation;
    if (!rotation) throw new StateError(`no active rotation for tenant: ${tenant}`);
    if (rotation.fromEpoch !== epoch) throw new StateError(`epoch is not the retiring epoch: ${epoch}`);
    if (rotation.remaining !== 0) throw new StateError("rotation still has unfinished tasks");
    for (const objectEpoch of state.objects.values()) {
      if (objectEpoch === epoch) throw new StateError(`objects still reference epoch: ${epoch}`);
    }
    state.rotation = undefined;
    state.retiredEpochs.push(epoch);
    return rotation;
  }
}
