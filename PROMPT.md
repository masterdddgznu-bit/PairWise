## 简述
在已有的进程内 ARIES 页存储上，补上两阶段提交的准备态：事务可以 prepare 后进入存疑，崩溃恢复不得把它们当失败者撤销，并且准备态持有的键锁必须随日志重建。

## 需求
- 从 `src/index.ts` 继续导出 `Store` 与 `StoreStats`。原有 `begin` / `put` / `del` / `get` / `read` / `commit` / `abort` / `flush` / `checkpoint` / `crash` / `recover` / `stats` 语义保持不变，原测试必须继续通过。
- 新增 `prepare(tx)`：仅活跃事务可准备；追加 prepare 日志后该事务离开活跃集、进入存疑。准备后不得再 `put` / `del`。`commit` / `abort` 仍可结束存疑事务（规则与原来的提交/撤销相同，包括 CLR 链）。
- `inDoubt()` 返回当前存疑事务号（排序确定）。`stats().active` 只计尚未 prepare 的活跃事务。
- 存疑事务占用的键锁在崩溃后仍有效：其他事务对那些键的 `put` / `del` 必须失败且不写日志。`read` 不得看见存疑事务尚未提交的写入。
- `checkpoint` 须能让分析阶段区分活跃与存疑。恢复时：未准备的活跃事务仍是失败者并按原规则撤销；存疑事务不得撤销、不得补 abort，并留在 `inDoubt()` 中直到随后的 `commit` 或 `abort`。再次 `crash` + `recover` 不得对同一失败者重复追加 abort，也不得把存疑事务变成失败者。
- `snapshot` 类查询若有返回值须为防御性副本。失败操作不得留下部分日志或部分锁。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改已有 `tests/store.test.ts`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 事务号、lsn 为安全正整数递增；key 为非空字符串。
- 新能力须拆到多个实质模块里协作，禁止只在原 `Store` 上加一个空方法。

## 验收
`npm test` 与 `npm run build` 全部通过。
