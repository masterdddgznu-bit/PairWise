## 简述

实现进程内衰减优先级队列：项按有效分排序出队，有效分随 `VirtualClock` 衰减；出队必须通过租户配额；拒绝/过期路径进入死信并可按规则回收。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`DecayQ`，以及错误类 `DecayQError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidScoreError` / `InvalidTenantError` / `CapacityError` / `UnknownIdError` / `UnknownTenantError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new DecayQ({
  clock,
  maxItems?: number,          // 排队中上限，默认 16，>= 1
  decayPerMs: number,         // 每毫秒从 baseScore 减去的量，有限数 >= 0
  defaultTtlMs?: number,      // 默认 TTL，缺省 1000，整数 >= 1
  tenants: Array<{
    id: string;
    maxInflight: number;      // 同时已 pop 未 complete 的上限，>= 1
    maxPops?: number;         // 累计成功 pop 上限；缺省无上限
  }>,
})
```

`tenants` 非空、id 唯一，否则 `InvalidConfigError`。其它非法配置同样抛 `InvalidConfigError`。

项生命周期：`queued` →（`pop` 成功）`inflight` →（`complete`）结束；或进入 `dead`（死信）。

有效分：`effectiveScore(id) = baseScore - decayPerMs * (now - enqueuedAt)`（浮点运算；比较时若并列，更早 `enqueuedAt` 优先，再比首次入队序）。

`enqueue(id, tenantId, payload, baseScore, ttlMs?: number): { status: 'queued' }`

- `id` 非空；重复 id（仍 queued/inflight）→ `InvalidIdError`。
- 未知 `tenantId` → `UnknownTenantError`。
- `baseScore` 有限数，否则 `InvalidScoreError`。
- `ttlMs` 缺省用 `defaultTtlMs`；整数 `>= 1`。
- 到期时刻 `deadline = now + ttlMs`。
- 若当前 **queued** 数已达 `maxItems`：抛 `CapacityError`，**不**进死信。
- 成功入队：`queued`，占容量。

`cancel(id): boolean`

- 非法 id 抛错；不存在 `false`。
- `queued`：移除，不进死信，腾容量，`true`。
- `inflight`：不可 cancel → 抛错风格用 `InvalidIdError` 不合理；改为返回 `false` 且不改状态（测例覆盖）。
- 已在死信：`false`。

`pop(): { id; tenantId; payload; baseScore; effectiveScore } | null`

- 先执行过期清扫（见下）。
- 在仍 `queued` 且未过期的项中，按有效分**降序**（并列：更早 `enqueuedAt`，再更早入队序）扫描。
- 跳过当前租户 **inflight 已满** 或 **累计 pop 已达 maxPops** 的项（项仍留在队列）。
- 取第一个通过配额者：改为 `inflight`，该租户 inflight+1、pops+1，**不占 queued 容量**（出队腾出 queued 槽），返回快照（含当下 effectiveScore）。
- 若存在更高分项只因配额被跳过，仍可弹出更低分但配额允许的项。
- 无人可弹 → `null`。

`peek(): ... | null` — 与 pop 相同选择规则，但**不**改变状态、不占 inflight；计算 effectiveScore 用当前 now。

`complete(id): boolean` — `inflight` 则结束并 inflight-1，`true`；其它 `false`。

`pump(): { expired: string[] }` — 将 `queued` 且 `now >= deadline` 的项移入死信，原因 `expired`，返回被移 id（按入队序）。`inflight` 不过期。

过期清扫：`pop`/`peek`/`drive`/`enqueue` 开始时隐式等价于先 `pump`（测例会交错 advance 验证）。

`drive(limit?: number): { drained: Array<...> }` — 可选 `limit` 默认无限；反复 `pop` 直到 null 或达到 limit。

死信：

- `deadLetterIds(): string[]` 进入顺序。
- `deadReason(id): 'expired' | 'quota_refuse' | null` — 不存在 `null`。
- `reclaim(id): boolean` — 死信项重新入队为 `queued`：`enqueuedAt = now`，`deadline = now + defaultTtlMs`，保留原 `baseScore`/`tenantId`/`payload`；若 queued 已满 → `false` 且留在死信；成功则离开死信且原因清除，`true`。
- **quota_refuse**：当 `pop`/`drive` 时，若某项因该租户 `maxPops` 已满而**永远**不可能再被弹出（累计 pops >= maxPops），且该项是当前扫描中唯一障碍时不必立刻死信；测例约定：提供 `refuseQuota(id): boolean`——仅 `queued` 项可手动拒绝入死信原因 `quota_refuse`，腾 queued 容量，`true`。

查询：`size()` 仅计 `queued`；`inflightOf(tenantId)`；`popsOf(tenantId)`；`effectiveScore(id)`（非 queued → `null`）；`ids()` queued 入队序。

宜拆成衰减排序、租户配额、死信三块协作；内部文件名自定。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
