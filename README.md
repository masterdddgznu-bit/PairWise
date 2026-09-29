# threepc

进程内三阶段提交（3PC）：协调者对 cohort 广播 CanCommit → 收集投票 → PreCommit → 收集 Ack → DoCommit；任一步超时或否定票则 Abort。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
