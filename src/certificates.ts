import { CertificateSnapshot, CertificateStoreSnapshot } from "./types";
import { deepClone } from "./util";

export type CertificateRecord = CertificateSnapshot;

export class CertificateStore {
  private readonly tenants = new Map<string, Map<string, CertificateRecord>>();
  private readonly services = new Map<string, string>();

  createTenant(tenant: string): void {
    if (!this.tenants.has(tenant)) {
      this.tenants.set(tenant, new Map());
    }
  }

  has(tenant: string, serial: string): boolean {
    return this.tenants.get(tenant)?.has(serial) ?? false;
  }

  get(tenant: string, serial: string): CertificateRecord | undefined {
    return this.tenants.get(tenant)?.get(serial);
  }

  list(tenant: string): CertificateRecord[] {
    return [...(this.tenants.get(tenant)?.values() ?? [])];
  }

  count(): number {
    let total = 0;
    for (const certs of this.tenants.values()) {
      total += certs.size;
    }
    return total;
  }

  serviceOwner(service: string): string | undefined {
    return this.services.get(service);
  }

  add(tenant: string, cert: CertificateRecord): void {
    const certs = this.tenants.get(tenant);
    if (!certs) {
      throw new Error(`certificate store missing tenant: ${tenant}`);
    }
    certs.set(cert.serial, cert);
    this.services.set(cert.service, tenant);
  }

  snapshot(): CertificateStoreSnapshot {
    return {
      tenants: [...this.tenants.entries()].map(([tenant, certs]) => [
        tenant,
        [...certs.entries()].map(([serial, cert]) => [
          serial,
          deepClone(cert),
        ]) as [string, CertificateSnapshot][],
      ]),
      services: [...this.services.entries()],
    };
  }

  restore(snapshot: CertificateStoreSnapshot): void {
    this.tenants.clear();
    this.services.clear();
    for (const [tenant, certs] of snapshot.tenants) {
      this.tenants.set(
        tenant,
        new Map(certs.map(([serial, cert]) => [serial, deepClone(cert)])),
      );
    }
    for (const [service, tenant] of snapshot.services) {
      this.services.set(service, tenant);
    }
  }
}
