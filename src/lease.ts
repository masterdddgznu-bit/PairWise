export interface LeaseRecord {
  resourceId: string;
  ownerId: string;
  token: number;
  acquiredAt: number;
  expireAt: number;
}

export function createLease(
  resourceId: string,
  ownerId: string,
  token: number,
  acquiredAt: number,
  ttl: number,
): LeaseRecord {
  return {
    resourceId,
    ownerId,
    token,
    acquiredAt,
    expireAt: acquiredAt + ttl,
  };
}
