请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **多粒度锁定（multi-granularity locking）**：资源组成树；事务对节点申请 IS/IX/S/SIX/X；冲突则进入等待队列；加锁前做 waits-for 死锁检测。禁止真实网络 / DB / `setTimeout` / `Math.random`。

## 锁模式与兼容性

模式：`IS` | `IX` | `S` | `SIX` | `X`。

兼容矩阵（行=已持有，列=新请求；`Y` 兼容，`N` 冲突）——实现必须与此一致：

|     | IS | IX | S | SIX | X |
|-----|----|----|---|-----|---|
| IS  | Y  | Y  | Y | Y   | N |
| IX  | Y  | Y  | N | N   | N |
| S   | Y  | N  | Y | N   | N |
| SIX | Y  | N  | N | N   | N |
| X   | N  | N  | N | N   | N |

同一事务对同一资源再次 `acquire`：
- 若已持有相同或更强模式，返回 `granted`（不升级排队）；
- 强度序：`IS < IX < S < SIX < X`，且 `IX` 与 `S` 不可比（互相都不算“更强”）；升级到不可比或更强模式时，若与**其他事务**当前持有兼容则立刻升级，否则走等待/死锁逻辑。
- 简化：**测试不会要求 IX↔S 交叉升级**；只会同模式重入或沿 `IS→IX→SIX→X` / `IS→S→SIX→X` 升级。

## 资源树与祖先意向

构造时传入 `resources: { id, parent }[]`（`parent: null` 为根）。必须恰好一个根；其余节点 parent 必须存在；禁止环。

`acquire(txn, resource, mode)` **自动**沿祖先链补齐意向（已持有足够强则跳过）：
- 目标模式为 `IS` 或 `S`：每个祖先需要至少 `IS`（已有 `IX/S/SIX/X` 也算满足）；
- 目标模式为 `IX` / `SIX` / `X`：每个祖先需要至少 `IX`（`SIX/X` 也算满足）。

祖先补锁也必须走同一套兼容/等待/死锁规则（从根向叶子顺序加）。

## 等待与死锁

- 若新锁与**其他事务**已授予锁不兼容 → 进入该资源 FIFO 等待队列，返回 `waiting`。
- 建边：等待事务 → 每个冲突的持有者事务。若加入这些边后 waits-for 图出现环 → 抛 `DeadlockError`，**不入队**，状态不变。
- `release(txn, resource)`：释放该事务在该资源上的锁；然后按队列顺序尽可能授予前缀中可兼容的等待者（授予后出队）。同一事务持有多把锁时，只释放指定资源。
- `releaseAll(txn)`：释放该事务全部锁并尽量唤醒。
- 事务结束前未释放也可 `releaseAll`。

## API

```ts
new GranLock({ resources: Array<{ id: string; parent: string | null }> })
begin(): string                         // txn id: "t1","t2",...
acquire(txnId, resourceId, mode): "granted" | "waiting"
release(txnId, resourceId): void
releaseAll(txnId): void
modeOf(txnId, resourceId): LockMode | null
holders(resourceId): Array<{ txnId; mode }>  // 仅已授予
waiters(resourceId): Array<{ txnId; mode }> // FIFO
activeTxns(): string[]
```

错误：
- 未知事务/资源 → `InvalidIdError`
- 构造非法树 → `InvalidConfigError`
- 死锁 → `DeadlockError`

模块：`types` / `errors` / `compat` / `tree` / `waits` / `queue` / `granlock` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
