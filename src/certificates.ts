import { TrustRollError } from "./errors";
import { CertificateSnapshot, CertificatesSnapshot } from "./types";
import { deepCopy } from "./util";

export interface CertRecord {
  serial: string;
  identity: string;
  anchorGeneration: number;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  replaces: string | null;
  replacedBy: string | null;
}

export class CertificateStore {
  private readonly tenants = new Map<string, Map<string, CertRecord>>();
  private readonly identities = new Map<string, string>();

  private tenantMap(tenant: string, create: boolean): Map<string, CertRecord> | undefined {
    let map = this.tenants.get(tenant);
    if (!map && create) {
      map = new Map<string, CertRecord>();
      this.tenants.set(tenant, map);
    }
    return map;
  }

  identityOwner(identity: string): string | undefined {
    return this.identities.get(identity);
  }

  has(tenant: string, serial: string): boolean {
    return this.tenantMap(tenant, false)?.has(serial) ?? false;
  }

  get(tenant: string, serial: string): CertRecord | undefined {
    return this.tenantMap(tenant, false)?.get(serial);
  }

  countAll(): number {
    let total = 0;
    for (const map of this.tenants.values()) {
      total += map.size;
    }
    return total;
  }

  issue(tenant: string, record: CertRecord): CertRecord {
    const map = this.tenantMap(tenant, true)!;
    map.set(record.serial, record);
    if (!this.identities.has(record.identity)) {
      this.identities.set(record.identity, tenant);
    }
    return record;
  }

  list(tenant: string): CertRecord[] {
    return [...(this.tenantMap(tenant, false)?.values() ?? [])];
  }

  liveSourceSerials(tenant: string, target: number, now: number): string[] {
    return this.list(tenant)
      .filter(
        (cert) =>
          cert.anchorGeneration < target &&
          !cert.revoked &&
          cert.replacedBy === null &&
          cert.expiresAt > now,
      )
      .map((cert) => cert.serial)
      .sort();
  }

  hasLiveOldLineage(tenant: string, issuance: number, now: number): boolean {
    return this.list(tenant).some(
      (cert) =>
        cert.anchorGeneration < issuance &&
        !cert.revoked &&
        cert.replacedBy === null &&
        cert.expiresAt > now,
    );
  }

  snapshot(): CertificatesSnapshot {
    return {
      tenants: [...this.tenants.entries()].map(
        ([tenant, map]) =>
          [
            tenant,
            [...map.entries()].map(
              ([serial, cert]) => [serial, deepCopy(cert)] as [string, CertificateSnapshot],
            ),
          ] as [string, [string, CertificateSnapshot][]],
      ),
      identities: [...this.identities.entries()].map(
        ([identity, tenant]) => [identity, tenant] as [string, string],
      ),
    };
  }

  restore(snapshot: CertificatesSnapshot): void {
    this.tenants.clear();
    this.identities.clear();
    for (const [tenant, entries] of snapshot.tenants) {
      const map = new Map<string, CertRecord>();
      for (const [serial, cert] of entries) {
        map.set(serial, deepCopy(cert));
      }
      this.tenants.set(tenant, map);
    }
    for (const [identity, tenant] of snapshot.identities) {
      this.identities.set(identity, tenant);
    }
  }

  static validate(snapshot: CertificatesSnapshot): void {
    for (const [tenant, entries] of snapshot.tenants) {
      const bySerial = new Map<string, CertificateSnapshot>();
      for (const [serial, cert] of entries) {
        if (bySerial.has(serial) || cert.serial !== serial) {
          throw new TrustRollError(
            "JOURNAL_LINEAGE",
            `duplicate certificate serial ${serial} for tenant ${tenant}`,
          );
        }
        bySerial.set(serial, cert);
      }
      for (const [, cert] of entries) {
        if (cert.replaces !== null) {
          const prev = bySerial.get(cert.replaces);
          if (!prev || prev.replacedBy !== cert.serial) {
            throw new TrustRollError(
              "JOURNAL_LINEAGE",
              `certificate ${cert.serial} references missing lineage source`,
            );
          }
        }
        if (cert.replacedBy !== null) {
          const next = bySerial.get(cert.replacedBy);
          if (!next || next.replaces !== cert.serial) {
            throw new TrustRollError(
              "JOURNAL_LINEAGE",
              `certificate ${cert.serial} references missing lineage replacement`,
            );
          }
        }
      }
    }
  }
}
