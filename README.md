# votefinal

进程内法定人数 prepare/finalize 协调器：参与者名册、选票箱、事务表与决策 WAL 必须一致协作；超时由 VirtualClock 驱动，成功变更可经 `fromJournal` 重放恢复。仓库初始不含 `src/`，需从零实现并通过测试。

## 本地运行

```bash
npm install
npm test
npm run build
```
