import { CapacityError, ConflictError, StateError } from "./errors.js";

export interface RotationState {
  fromEpoch: string;
  toEpoch: string;
  taskIds: number[];
}

export interface TenantRecord {
  name: string;
  currentEpoch: string;
  retiredEpochs: string[];
  objects: Map<string, string>;
  rotation: RotationState | undefined;
}

export class TenantDirectory {
  private tenants = new Map<string, TenantRecord>();
  private objectTotal = 0;

  constructor(
    private readonly maxTenants: number,
    private readonly maxObjects: number,
  ) {}

  expect(name: string): TenantRecord {
    const record = this.tenants.get(name);
    if (!record) throw new StateError(`unknown tenant: ${name}`);
    return record;
  }

  registerTenant(name: string, epoch: string): void {
    if (this.tenants.has(name)) throw new ConflictError(`tenant already registered: ${name}`);
    if (this.tenants.size >= this.maxTenants) {
      throw new CapacityError(`tenant capacity reached: ${this.maxTenants}`);
    }
    this.tenants.set(name, {
      name,
      currentEpoch: epoch,
      retiredEpochs: [],
      objects: new Map(),
      rotation: undefined,
    });
  }

  registerObject(record: TenantRecord, objectId: string): string {
    if (record.objects.has(objectId)) {
      throw new ConflictError(`object already registered: ${record.name}/${objectId}`);
    }
    if (this.objectTotal >= this.maxObjects) {
      throw new CapacityError(`object capacity reached: ${this.maxObjects}`);
    }
    const epoch = record.currentEpoch;
    record.objects.set(objectId, epoch);
    this.objectTotal += 1;
    return epoch;
  }

  objectEpoch(record: TenantRecord, objectId: string): string {
    const epoch = record.objects.get(objectId);
    if (epoch === undefined) throw new StateError(`unknown object: ${record.name}/${objectId}`);
    return epoch;
  }

  objectsOnEpoch(record: TenantRecord, epoch: string): string[] {
    const result: string[] = [];
    for (const [objectId, objectEpoch] of record.objects) {
      if (objectEpoch === epoch) result.push(objectId);
    }
    return result;
  }

  setRotation(record: TenantRecord, fromEpoch: string, toEpoch: string, taskIds: number[]): void {
    record.currentEpoch = toEpoch;
    record.rotation = { fromEpoch, toEpoch, taskIds };
  }

  closeRotation(record: TenantRecord, epoch: string): void {
    record.retiredEpochs.push(epoch);
    record.rotation = undefined;
  }

  setObjectEpoch(record: TenantRecord, objectId: string, epoch: string): void {
    record.objects.set(objectId, epoch);
  }
}
