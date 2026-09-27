请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确授权（grant / revoke / check）。请在此基础上迭代实现角色继承、资源通配、TTL 临时授权、显式 deny、事件 Watch、原子事务与 Compact，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `AuthzPolicy`（见 `src/policy.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `grant(subject, role, resource)`：授予 subject 在 resource 上的 role（allow）
- `revoke(subject, role, resource) -> boolean`：撤销精确匹配的授权；不存在返回 false
- `check(subject, role, resource) -> boolean`：是否存在精确 allow
- `grants(subject) -> Grant[]`：该 subject 当前有效授权列表（字典序：role 再 resource）
- `Grant`: `{ subject, role, resource, effect: 'allow'|'deny', expireAt: number | null }`
  - 基础实现：`effect` 恒为 `allow`，`expireAt` 恒为 `null`

## 待迭代功能

**角色继承**
- `addRoleParent(child, parent)`：child 继承 parent 的权限；环检测抛 `CycleError`
- `check` 时若 subject 对 resource 拥有父角色权限，亦视为通过（allow 路径）

**资源通配**
- resource 支持尾缀 `*`，如 `docs/*` 匹配 `docs/a`、`docs/a/b`（前缀匹配，`*` 仅可出现在末尾且前为 `/` 或整串 `*`）
- `*` 匹配任意 resource
- 更具体（更长前缀）的规则优先；同长度时 deny 优先于 allow

**TTL 临时授权**
- `grant(subject, role, resource, opts?: { ttlMs?: number; effect?: 'allow'|'deny' })`
- 到期后 `check` / `grants` / `tick` 视为不存在
- `tick()`：清理过期授权并记 `expire` 事件

**Deny**
- `effect: 'deny'` 显式拒绝；匹配时 `check` 返回 false，即使存在继承/通配 allow
- deny 与 allow 同时匹配时 deny 胜出

**Watch**
- 事件 `{ seq, type, subject, role, resource, at }`
- `type`: `grant` | `revoke` | `expire`
- `watch` / `pollWatch` / `unwatch`；`fromSeq < watermark` 抛 `CompactedError`

**事务 `txn(ops) -> void`**
- `ops`: `{type:'grant'|'revoke'|'addRoleParent', ...}[]`
- 全部成功或全部失败；任一步失败（如 CycleError、revoke 目标不存在）→ 抛 `TxnError`，无副作用
- 成功时各操作按序产生事件；共享同一逻辑提交（测试只要求最终状态与事件顺序正确）

**Compact**
- `compact(beforeSeq)` 后 `watch(fromSeq < beforeSeq)` 抛 `CompactedError`

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/roles.ts` — 角色继承图
- `src/grants.ts` — 授权存储与匹配
- `src/ttl.ts` — 过期
- `src/events.ts` — Watch / Compact
- `src/txn.ts` — 事务
- `src/policy.ts` — `AuthzPolicy` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
