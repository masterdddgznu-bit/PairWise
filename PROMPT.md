请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单线程 KV（put / get / delete / has / keys / size）。请在此基础上迭代实现快照隔离事务、写-写冲突检测，以及 SSI 写偏斜检测，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。逻辑时间用内部提交序号即可（可保留 `VirtualClock` 但不强制驱动隔离语义）。

对外入口是 `SkewStore`（见 `src/store.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `put(key, value)` / `get` / `delete` / `has` / `keys()`（字典序）/ `size()`
- 无版本、无事务；直接改当前可见状态
- 基础 API 与事务 API **独立**：测试不会把基础 put 与未提交事务写混在同一断言里依赖彼此

## 待迭代功能

**事务生命周期**
- `begin() -> txId`：分配 id（`t1`,`t2`,…）；记下 `snapTs = 当前全局提交时钟`（初始时钟为 0；每成功 commit 一次时钟 +1，commit 得到的 `commitTs` 为递增后的值）
- `read(tx, key) -> string | undefined`
  - 若事务已 abort/commit：抛 `TxStateError`
  - 若 key 在本事务写集：返回写集值（删除则 undefined）
  - 否则读取**提交时间 `commitTs <= snapTs`** 的最新版本；无则 undefined
  - 将 key 记入读集（即使结果为 undefined 也记入）
- `write(tx, key, value: string): void`：写入本地写集（覆盖）；记入写集
- `delete(tx, key): void`：写集记为删除（可见为 undefined）；键仍属写集
- `abort(tx): void`：标记 aborted；重复 abort 幂等；对已 commit 抛 `TxStateError`
- `status(tx) -> "active" | "committed" | "aborted"`

**commit(tx): void**
- 非 active 抛 `TxStateError`
- 空写集：直接 committed，**仍占用一次** commitTs 递增（便于测试时钟）
- 否则令 `commitTs = ++clock`，然后按序检查：
  1. **WW**：若写集中任一字，存在已提交版本满足 `commitTs_other > snapTs`（即快照之后已有提交写），抛 `ConflictError("ww")` 并 abort
  2. **Write skew (SSI)**：对任意已提交事务 `C` 满足 `snapTs < C.commitTs < commitTs`（不含自己）：
     - 若 `readSet(tx) ∩ writeSet(C) ≠ ∅` **且** `writeSet(tx) ∩ readSet(C) ≠ ∅`，抛 `ConflictError("skew")` 并 abort
  3. 通过则安装写集为新版本（value 或 tombstone），状态 committed
- 冲突中止后 `status` 为 aborted；版本不得被安装

**只读辅助**
- `committedValue(key) -> string | undefined`：最新已提交非 tombstone 版本（忽略未提交写）
- `commitTs() -> number`：当前全局提交时钟

**经典写偏斜**
- T1：read(y), write(x)；T2：read(x), write(y)；在两者都未 commit 前交叉读写后，先 commit 者成功，后 commit 者必须因 `"skew"` 失败（若无 WW）

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/version.ts` — 多版本链
- `src/txn.ts` — 事务状态、读写集
- `src/conflict.ts` — WW / skew 检测
- `src/store.ts` — `SkewStore` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
