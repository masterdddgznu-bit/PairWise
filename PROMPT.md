请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `WaitGate`：主入口类
- 错误类：`WaitGateError`，以及至少  
  `InvalidConfigError` / `InvalidWaitError` / `UnknownWaitError` / `FenceError`

## 构造

```ts
new WaitGate({
  clock: VirtualClock,
  defaultTimeoutMs: number,  // >= 1
  maxParties?: number,       // 默认 32，>= 1；单次 open 参与方上限
})
```

非法 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

每次 `open` 创建一次等待，`waitId` 全局从 1 递增。状态：`open | done | timedOut | cancelled`。

### open

```ts
open(parties: string[], opts?: { timeoutMs?: number }): { waitId: number; gen: number; deadline: number }
```

- `parties` 非空、元素非空、**去重后**人数 `1..maxParties`；有空串/超限/空列表 → `InvalidWaitError`。  
  内部保存的参与方集合为 **去重后字典序**（arrive 仍用原名，但重复名只算一方）。  
- `timeoutMs` 默认 `defaultTimeoutMs`，须 `>= 1`。  
- `deadline = now + timeoutMs`。  
- `gen` 对该 wait **恒为 1**（本实现不做 reopen；留 gen 字段供 arrive/cancel 校验，恒传 1）。  
- 初始无人到达。

### arrive / cancel

- `arrive(waitId, gen, party: string): 'ok' | 'duplicate' | 'late'`  
  - 未知 wait → `UnknownWaitError`；`gen !== 1` → `FenceError`。  
  - `party` 不在参与方集合 → `InvalidWaitError`。  
  - 若状态已是 `done|timedOut|cancelled`：返回 `'late'`（不改状态）。  
  - 若该 party 已到达过：`'duplicate'`。  
  - 否则记录到达；若至此全部到齐 → 状态 `done`，生成结果事件；返回 `'ok'`。

- `cancel(waitId, gen): boolean`  
  - 仅 `open` → `cancelled` 并生成结果，`true`；已终态 → `false`；未知/错 gen 同上抛错。

### drive / poll

- `drive(): { timedOut: number[] }`  
  对所有 `open` 且 `now >= deadline` 的 wait：标 `timedOut`，生成结果；`timedOut` 为 waitId 升序。

- `poll(maxn?: number): WaitResult[]`  
  ```ts
  type WaitResult = {
    waitId: number;
    status: 'done' | 'timedOut' | 'cancelled';
    arrived: string[];   // 字典序
    missing: string[];   // 字典序；done 时为空；cancelled/timedOut 为未到达者
  }
  ```
  取出结果队列前缀；`maxn` 默认全部，若给须 `>= 1`。

### 查询

- `status(waitId)` / `arrivedOf(waitId): string[]` / `missingOf(waitId): string[]` / `deadlineOf(waitId)`  
  - 未知 → `UnknownWaitError`。  
  - `missingOf`：参与方减已到达（终态后仍可查快照）。

自行决定模块拆分；正确性以不变量与 tests 为准。
