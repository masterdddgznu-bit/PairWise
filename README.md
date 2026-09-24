# raftlog

单进程里的 Raft 日志状态机：任期与投票、日志一致性检查、只提交当前任期的日志、快照安装，以及崩溃后恰好应用一次。

`src/raft_node.ts` 仍是空实现。补全后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
