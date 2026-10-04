请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `TtlMap`：主入口类
- 错误类：`TtlMapError`，以及至少  
  `InvalidConfigError` / `InvalidKeyError` / `CasError` / `CapacityError`

## 构造

```ts
new TtlMap({
  clock: VirtualClock,
  capacity: number,          // >= 1；存活条目（value 或 tombstone）上限
  defaultTtlMs: number,      // >= 1；set 默认存活时长
  tombstoneTtlMs?: number,   // 默认 = defaultTtlMs，>= 1；delete 后墓碑存活
})
```

非法 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

每个 key 至多一条记录，形态：

- `live { kind:'live'; value; gen; expireAt; setAt }`
- `tomb { kind:'tomb'; gen; expireAt; setAt }`（delete 产生）

`gen` 从 1 起，对该 key **每次成功写入 live 或写入 tomb 都 +1**（同一 key 上单调）。

### 过期

记录在 `now >= expireAt` 时视为过期。  
**惰性**：`get` / `cas` / `set` / `delete` / `has` 触及某 key 时若已过期则先清除该记录（不计入返回值）。  
**驱动**：`drive()` 扫描并清除所有已过期记录，返回被清除的 key 字典序。

### set / get / has / delete

- `set(key, value, opts?: { ttlMs?: number; expectGen?: number }): { gen: number }`  
  - key 非空 string，value 为 string，否则 `InvalidKeyError`。  
  - `ttlMs` 默认 `defaultTtlMs`，须 `>= 1`。  
  - 若提供 `expectGen`：则当前必须存在**未过期 live** 且 `gen === expectGen`，否则 `CasError`；墓碑/不存在/过期都不匹配。  
  - 写入 live：`expireAt = now + ttlMs`，`setAt = now`，`gen = (旧记录未过期 ? 旧gen+1 : 1)`——**更正：若清除过期后无记录则 gen=1；若覆盖未过期 live/tomb 则 gen=旧gen+1**。  
  - 若写入前（惰性清过期后）条目数已达 capacity 且 key **不是**已有未过期记录的原地更新：先 `drive` 式清所有过期；若仍满且非原地更新 → 淘汰一条：**选 expireAt 最小，同等选 key 字典序最小**（含 tomb）；若淘汰后仍无法插入（理论上不会）→ `CapacityError`。  
  - 返回新 gen。

- `get(key): { value: string; gen: number } | undefined`  
  仅未过期 live；tomb/过期/无 → `undefined`（过期会惰性清除）。

- `has(key): boolean`：未过期 live 为 true。

- `delete(key): boolean`  
  - 若存在未过期 live：改为 tomb，`gen+=1`，`expireAt=now+tombstoneTtlMs`，`setAt=now`，`true`。  
  - 若已是 tomb 或无/过期：惰性清过期后 `false`（不新建 tomb）。

### cas

- `cas(key, expectGen, value, opts?: { ttlMs?: number }): { gen: number }`  
  等价于 `set(key, value, { ttlMs, expectGen })`，失败抛 `CasError`。

### 查询

- `size(): number`：当前未过期记录数（live+tomb，先可全量惰性不清，**约定 size 不做全表惰性，只计结构中仍存且 `now < expireAt` 的**）。  
- `genOf(key): number | undefined`：未过期记录的 gen（live 或 tomb）；过期惰性清除后 undefined。  
- `keys(): string[]`：未过期 key 字典序。

自行决定模块拆分；正确性以不变量与 tests 为准。
