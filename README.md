# paxos1

进程内单决议 Paxos：Prepare/Promise、Accept/Accepted、多数派选定、ballot 冲突、VirtualClock 阶段超时提 ballot 重试。各模块仅为可编译空壳，需从零实现完整语义。

实现完成后应让 `npm test` 与 `npm run build` 通过。

## 本地运行

```bash
npm install
npm test
npm run build
```
