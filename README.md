# txnprep

进程内 **多参与者事务预备/提交**：协调者状态机、参与者资源锁、prepare/commit 超时，以及 journal 导出/导入做崩溃恢复。`src/` 为空壳，需从零实现。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
