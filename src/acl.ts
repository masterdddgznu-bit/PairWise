export type Perm = "read" | "write";

export type AclRule = { user: string; perm: Perm; prefix: string };

/**
 * 前缀 ACL。
 */
export class Acl {
  private readonly rules: AclRule[];

  constructor(rules: AclRule[]) {
    this.rules = rules.slice();
  }

  check(user: string, perm: Perm, key: string): boolean {
    return this.rules.some(
      (rule) =>
        rule.user === user && rule.perm === perm && key.startsWith(rule.prefix),
    );
  }
}
