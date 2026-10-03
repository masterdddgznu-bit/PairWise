请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **多租户请求准入（AdmitCtl）**：在全局并发与租户配额约束下决定请求立刻运行还是入队；槽位释放时用 **Deficit Round Robin (DRR)** 从等待队列选下一个；排队过久则超时失败。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 不变量（验收以这些为准，实现结构自定）

1. **全局并发**：同一时刻 `running` 请求数 ≤ `globalLimit`。
2. **租户 in-flight**：租户 t 的 `running` 数 ≤ 该租户 `maxInFlight`。
3. **唯一 requestId**：重复 `submit` 同一 `requestId` → `DuplicateRequestError`（无论其处于 queued/running/已结束历史——已结束若再次 submit 也算重复，直至 `reset()`）。
4. **DRR 出队**：每个租户一条 FIFO 等待子队列，并维护 `deficit`（初始 0）与轮询游标（租户 id **升序**环）。每当需要补位（`complete`/`cancel`/`pump` 后）时反复挑选，直到无法再启动：
   - 从当前游标起扫描租户；
   - 等待为空：将该租户 `deficit` 置 0，看下一个；
   - 等待非空但此刻配额不允许启动该租户：跳过（保留 deficit），看下一个；
   - 等待非空且可启动：先 `deficit += weight`；只要 `deficit > 0` 且仍可启动且队列非空，弹出队头启动，`deficit -= 1`；**若启动后该租户 deficit 仍 > 0，游标留在该租户**，否则游标移到下一个租户；
   - 若整环无人可启动则停止。
5. **超时**：`submit(..., timeoutMs)` 入队时记录 `deadline = clock.now() + timeoutMs`。之后任意时刻调用 `pump()`：凡仍 `queued` 且 `clock.now() >= deadline` 的请求变为 `timeout`，并离开队列；不占运行槽。`timeoutMs` 缺省为 `null`（永不因超时出队）。
6. **完成/取消**：
   - `complete(requestId)`：仅 `running` 可完成 → `done` 并释放槽，然后尝试 DRR 补位；其它状态 → `InvalidStateError`。
   - `cancel(requestId)`：`queued` → 出队为 `cancelled`；`running` → 释放槽为 `cancelled` 并 DRR 补位；已结束 → `InvalidStateError`。
7. **查询**：`statusOf` / `runningCount` / `queuedCount` / `runningCountOf(tenant)` / `queuedCountOf(tenant)` / `servedCountOf(tenant)`（累计成功 `complete` 次数）/ `deficitOf(tenant)` / `phase`（未特别需要复杂 phase：始终可操作；`reset` 后清空一切）。

## API 轮廓

```ts
new AdmitCtl({
  clock: VirtualClock,
  globalLimit: number,           // >= 1
  tenants: Array<{ id: string; weight: number; maxInFlight: number }>,
})
```

- `tenants` 不能为空；`id` 唯一；`weight >= 1`；`maxInFlight >= 1`；否则 `InvalidConfigError`。
- `submit(tenantId, requestId, timeoutMs?: number | null): 'running' | 'queued'`
  - 未知租户 → `UnknownTenantError`
  - 若当前（全局与该租户）配额都允许 → 直接 `running`
  - 否则 → `queued`（排到该租户 FIFO 尾部）
- `complete` / `cancel` / `pump` / `reset` / 上述查询

## 模块划分（文件名需存在并可被 index 导出）

`clock` / `types` / `errors` / `tenant` / `queue` / `drr` / `limiter` / `admitctl` / `index`

你可以自行决定状态放在哪一层，但 **不要改 `tests/`**，且需通过 `npm test` 与 `npm run build`。
