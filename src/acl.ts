export type Perm = "read" | "write";

export type AclRule = { user: string; perm: Perm; prefix: string };

/**
 * 前缀 ACL。
 */
export class Acl {
  private readonly rules: AclRule[];

  constructor(rules: AclRule[]) {
    this.rules = rules.map((r) => ({ ...r }));
  }

  check(user: string, perm: Perm, key: string): boolean {
    return this.rules.some(
      (r) => r.user === user && r.perm === perm && key.startsWith(r.prefix),
    );
  }
}
